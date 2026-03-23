import type { DatabaseQueryable } from '../db/database.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import {
  readAssessmentSubjectLinkage,
  readWorkflowTaskKind,
} from './assessment-subject-service.js';
import {
  deriveWorkflowStageProjection,
} from './workflow-stage-projection.js';
import {
  queryWorkflowStageViews,
  type WorkflowStageResponse,
} from './workflow-stage-service.js';

interface ActivationRow {
  id: string;
  activation_id: string | null;
  reason: string;
  event_type: string;
  payload: Record<string, unknown>;
  state: string;
  dispatch_attempt: number;
  dispatch_token: string | null;
  queued_at: Date;
  started_at: Date | null;
  consumed_at: Date | null;
  completed_at: Date | null;
  summary: string | null;
  error: Record<string, unknown> | null;
}

interface WorkflowRow {
  id: string;
  name: string;
  lifecycle: string | null;
  metadata: Record<string, unknown> | null;
  playbook_name: string;
  playbook_outcome: string | null;
  playbook_definition: Record<string, unknown>;
}

interface PlaybookRoleDefinitionRow {
  name: string;
  description: string | null;
}

interface PendingDispatch {
  work_item_id: string;
  stage_name: string | null;
  actor: string;
  action: string;
  title: string | null;
}

export async function buildOrchestratorTaskContext(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
) {
  if (!task.is_orchestrator_task || !task.workflow_id) {
    return null;
  }

  const workflowId = String(task.workflow_id);
  const taskMetadata = asRecord(task.metadata);
  const activationId =
    typeof task.activation_id === 'string' && task.activation_id.trim().length > 0
      ? task.activation_id
      : null;

  const [workflowRes, activationRes, workItemsRes, stagesRes, tasksRes, queuedActivationsRes] =
    await Promise.all([
      db.query<WorkflowRow>(
        `SELECT w.id,
                w.name,
                w.lifecycle,
                w.metadata,
                p.name AS playbook_name,
                p.outcome AS playbook_outcome,
                p.definition AS playbook_definition
           FROM workflows w
           JOIN playbooks p
             ON p.tenant_id = w.tenant_id
            AND p.id = w.playbook_id
          WHERE w.tenant_id = $1
            AND w.id = $2`,
        [tenantId, workflowId],
      ),
      activationId
        ? db.query<ActivationRow>(
            `SELECT id, activation_id, reason, event_type, payload, state, queued_at, started_at,
                    dispatch_attempt, dispatch_token, consumed_at, completed_at, summary, error
               FROM workflow_activations
              WHERE tenant_id = $1
                AND (id = $2 OR activation_id = $2)
              ORDER BY queued_at ASC`,
            [tenantId, activationId],
          )
        : Promise.resolve({ rows: [] }),
      db.query<Record<string, unknown>>(
        `SELECT id,
                parent_work_item_id,
                stage_name,
                title,
                goal,
                column_id,
                owner_role,
                next_expected_actor,
                next_expected_action,
                rework_count,
                priority,
                completed_at,
                notes,
                metadata,
                latest_delivery.subject_role AS current_subject_role,
                latest_delivery.subject_revision AS current_subject_revision
           FROM workflow_work_items
           LEFT JOIN LATERAL (
             SELECT th.role AS subject_role,
                    NULLIF(COALESCE(NULLIF(th.role_data->>'subject_revision', '')::int, 0), 0) AS subject_revision
               FROM task_handoffs th
              WHERE th.tenant_id = workflow_work_items.tenant_id
                AND th.workflow_id = workflow_work_items.workflow_id
                AND th.work_item_id = workflow_work_items.id
                AND COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'
                AND th.completion = 'full'
              ORDER BY th.sequence DESC, th.created_at DESC
              LIMIT 1
           ) latest_delivery ON true
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY created_at ASC`,
        [tenantId, workflowId],
      ),
      queryWorkflowStageViews(db, tenantId, workflowId),
      db.query<Record<string, unknown>>(
        `SELECT id,
                title,
                role,
                state,
                work_item_id,
                stage_name,
                activation_id,
                assigned_agent_id,
                claimed_at,
                started_at,
                completed_at,
                is_orchestrator_task,
                input,
                metadata
           FROM tasks
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY created_at DESC
          LIMIT 100`,
        [tenantId, workflowId],
      ),
      db.query<Record<string, unknown>>(
        `SELECT id, activation_id, reason, event_type, payload, state, queued_at, started_at,
                dispatch_attempt, dispatch_token, consumed_at, completed_at, summary, error
           FROM workflow_activations
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND consumed_at IS NULL
            AND activation_id IS NULL
            AND state = 'queued'
          ORDER BY queued_at ASC
          LIMIT 20`,
        [tenantId, workflowId],
      ),
    ]);

  const workflow = workflowRes.rows[0];
  if (!workflow) {
    return null;
  }
  const stageRows = stagesRes;
  const lifecycle = workflow.lifecycle === 'ongoing' ? 'ongoing' : 'planned';
  const roleDefinitions = await loadPlaybookRoleDefinitions(
    db,
    tenantId,
    workflow.playbook_definition,
  );
  const definition = parsePlaybookDefinition(workflow.playbook_definition);
  const projection = deriveWorkflowStageProjection({
    lifecycle,
    stageRows,
    openWorkItemStageNames: activeStageNames(workItemsRes.rows),
    definition: workflow.playbook_definition,
  });
  const serializedWorkItems = workItemsRes.rows.map(serializeWorkItem);
  const serializedTasks = tasksRes.rows.map(serializeDates);
  const pendingDispatches = derivePendingDispatches(serializedWorkItems, serializedTasks, definition);
  const workflowContext = {
    id: workflow.id,
    name: workflow.name,
    lifecycle: workflow.lifecycle,
    active_stages: projection.activeStages,
    metadata: workflow.metadata ?? {},
    playbook: {
      name: workflow.playbook_name,
      outcome: workflow.playbook_outcome,
      definition: workflow.playbook_definition,
    },
    role_definitions: roleDefinitions,
  } as Record<string, unknown>;
  if (workflow.lifecycle !== 'ongoing') {
    workflowContext.current_stage = projection.currentStage;
  }

  return {
    activation: activationRes.rows[0] ? serializeActivationBatch(activationId ?? activationRes.rows[0].id, activationRes.rows) : null,
    last_activation_checkpoint:
      Object.keys(asRecord(taskMetadata.last_activation_checkpoint)).length > 0
        ? asRecord(taskMetadata.last_activation_checkpoint)
        : null,
    workflow: workflowContext,
    board: {
      work_items: serializedWorkItems,
      stages: stageRows,
      tasks: serializedTasks,
      pending_dispatches: pendingDispatches,
      queued_activations: queuedActivationsRes.rows.map(serializeDates),
    },
  };
}

function serializeActivation(row: ActivationRow) {
  return {
    ...row,
    queued_at: row.queued_at.toISOString(),
    dispatch_attempt: row.dispatch_attempt,
    dispatch_token: row.dispatch_token,
    started_at: row.started_at?.toISOString() ?? null,
    consumed_at: row.consumed_at?.toISOString() ?? null,
    completed_at: row.completed_at?.toISOString() ?? null,
  };
}

function serializeActivationBatch(activationId: string, rows: ActivationRow[]) {
  const sorted = rows
    .slice()
    .sort((left, right) => left.queued_at.getTime() - right.queued_at.getTime());
  const anchor = sorted.find((row) => row.id === activationId) ?? sorted[0];
  return {
    ...serializeActivation(anchor),
    activation_id: anchor.activation_id ?? anchor.id,
    event_count: sorted.length,
    events: sorted.map((row) => serializeActivation(row)),
  };
}

function serializeDates(row: Record<string, unknown>) {
  const serialized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    serialized[key] = value instanceof Date ? value.toISOString() : value;
  }
  return serialized;
}

function serializeWorkItem(row: Record<string, unknown>) {
  const serialized = serializeDates(row);
  const continuity = asRecord(asRecord(serialized.metadata).orchestrator_finish_state);
  return {
    ...serialized,
    stage_name: typeof serialized.stage_name === 'string' ? serialized.stage_name : null,
    continuity: Object.keys(continuity).length > 0 ? continuity : null,
  };
}

function activeStageNames(rows: Record<string, unknown>[]): string[] {
  return Array.from(
    new Set(
      rows
        .filter((row) => row.completed_at == null && typeof row.stage_name === 'string')
        .map((row) => String(row.stage_name)),
    ),
  );
}

function derivePendingDispatches(
  workItems: Record<string, unknown>[],
  tasks: Record<string, unknown>[],
  definition: ReturnType<typeof parsePlaybookDefinition>,
): PendingDispatch[] {
  return workItems.flatMap((workItem) => {
    if (workItem.completed_at !== null && workItem.completed_at !== undefined) {
      return [];
    }

    const workItemId = readOptionalString(workItem.id);
    const actor = readOptionalString(workItem.next_expected_actor);
    const action = readOptionalString(workItem.next_expected_action);
    if (!workItemId || !action) {
      return [];
    }
    if (!actor && action === 'assess') {
      return derivePendingAssessmentDispatches(workItem, tasks, definition);
    }
    if (!actor || actor === 'human') {
      return [];
    }
    if (action === 'assess' && hasOpenChildAssessmentDispatchOwner(workItems, workItemId, actor)) {
      return [];
    }

    const hasOpenMatchingTask = tasks.some(
      (task) =>
        task.is_orchestrator_task !== true
        && readOptionalString(task.work_item_id) === workItemId
        && readOptionalString(task.role) === actor
        && isOpenSpecialistTask(task),
    );
    if (hasOpenMatchingTask) {
      return [];
    }

    return [{
      work_item_id: workItemId,
      stage_name: readOptionalString(workItem.stage_name),
      actor,
      action,
      title: readOptionalString(workItem.title),
    }];
  });
}

function derivePendingAssessmentDispatches(
  workItem: Record<string, unknown>,
  tasks: Record<string, unknown>[],
  definition: ReturnType<typeof parsePlaybookDefinition>,
): PendingDispatch[] {
  const workItemId = readOptionalString(workItem.id);
  const stageName = readOptionalString(workItem.stage_name);
  const title = readOptionalString(workItem.title);
  const subjectRole = readOptionalString(workItem.current_subject_role)
    ?? readOptionalString(workItem.owner_role);
  const subjectRevision = readOptionalPositiveInteger(workItem.current_subject_revision);
  if (!workItemId || !stageName || !subjectRole || subjectRevision === null) {
    return [];
  }

  const assessorRoles = Array.from(
    new Set(
      definition.assessment_rules
        .filter(
          (rule) =>
            rule.subject_role === subjectRole
            && ruleAppliesToCheckpoint(rule.checkpoint, stageName)
            && rule.required !== false,
        )
        .map((rule) => rule.assessed_by)
        .filter((role): role is string => typeof role === 'string' && role.trim().length > 0),
    ),
  );

  return assessorRoles.flatMap((actor) => {
    const matchingTasks = tasks.filter(
      (task) =>
        task.is_orchestrator_task !== true
        && readOptionalString(task.work_item_id) === workItemId
        && readOptionalString(task.role) === actor
        && isAssessmentTaskForSubjectRevision(task, subjectRevision),
    );
    if (matchingTasks.some(isOpenSpecialistTask)) {
      return [];
    }
    if (matchingTasks.some((task) => readOptionalString(task.state) === 'completed')) {
      return [];
    }
    return [{
      work_item_id: workItemId,
      stage_name: stageName,
      actor,
      action: 'assess',
      title,
    }];
  });
}

function hasOpenChildAssessmentDispatchOwner(
  workItems: Record<string, unknown>[],
  parentWorkItemId: string,
  actor: string,
): boolean {
  return workItems.some(
    (workItem) =>
      workItem.completed_at == null
      && readOptionalString(workItem.parent_work_item_id) === parentWorkItemId
      && readOptionalString(workItem.next_expected_action) === 'assess'
      && readOptionalString(workItem.next_expected_actor) === actor,
  );
}

function isOpenSpecialistTask(task: Record<string, unknown>): boolean {
  const state = readOptionalString(task.state);
  return state === 'ready'
    || state === 'claimed'
    || state === 'in_progress'
    || state === 'awaiting_approval'
    || state === 'output_pending_assessment';
}

function isAssessmentTaskForSubjectRevision(
  task: Record<string, unknown>,
  subjectRevision: number,
) {
  const metadata = asRecord(task.metadata);
  if (readWorkflowTaskKind(metadata, Boolean(task.is_orchestrator_task)) !== 'assessment') {
    return false;
  }
  const linkage = readAssessmentSubjectLinkage(asRecord(task.input), metadata);
  return linkage.subjectRevision === subjectRevision;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readOptionalPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function ruleAppliesToCheckpoint(ruleCheckpoint: string | undefined, checkpointName: string | null) {
  if (!ruleCheckpoint) {
    return true;
  }
  return checkpointName === ruleCheckpoint;
}

async function loadPlaybookRoleDefinitions(
  db: DatabaseQueryable,
  tenantId: string,
  playbookDefinition: Record<string, unknown>,
): Promise<Array<{ name: string; description: string | null }>> {
  const roleNames = readPlaybookRoleNames(playbookDefinition);
  if (roleNames.length === 0) {
    return [];
  }

  const result = await db.query<PlaybookRoleDefinitionRow>(
    `SELECT name, description
       FROM role_definitions
      WHERE tenant_id = $1
        AND is_active = true
        AND name = ANY($2::text[])`,
    [tenantId, roleNames],
  );
  const descriptions = new Map(
    result.rows.map((row) => [row.name, row.description ?? null]),
  );

  return roleNames.map((name) => ({
    name,
    description: descriptions.get(name) ?? null,
  }));
}

function readPlaybookRoleNames(playbookDefinition: Record<string, unknown>): string[] {
  try {
    return parsePlaybookDefinition(playbookDefinition).roles;
  } catch {
    const roles = Array.isArray(playbookDefinition.roles) ? playbookDefinition.roles : [];
    return Array.from(
      new Set(
        roles
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      ),
    );
  }
}
