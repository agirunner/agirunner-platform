import type { DatabaseQueryable } from '../db/database.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import {
  readAssessmentSubjectLinkage,
  readWorkflowTaskKind,
} from './assessment-subject-service.js';
import {
  guidedClosureContextSchema,
  type GuidedClosureContext,
  type GuidedClosureSuggestedAction,
} from './guided-closure/types.js';
import { buildStageRoleCoverage } from './stage-role-coverage.js';
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

interface StageGateRow {
  id: string;
  stage_name: string;
  status: string;
  closure_effect: string | null;
  requested_by_work_item_id: string | null;
  request_summary: string | null;
}

interface EscalationRow {
  id: string;
  work_item_id: string | null;
  reason: string;
  closure_effect: string | null;
  status: string;
}

interface ToolResultRow {
  mutation_outcome: string | null;
  recovery_class: string | null;
  response: Record<string, unknown> | null;
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

  const [workflowRes, activationRes, workItemsRes, stagesRes, tasksRes, queuedActivationsRes, stageGatesRes, escalationsRes, toolResultsRes] =
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
                retry_count,
                rework_count,
                error,
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
      db.query<StageGateRow>(
        `SELECT id,
                stage_name,
                status,
                closure_effect,
                requested_by_work_item_id,
                request_summary
           FROM workflow_stage_gates
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY requested_at DESC
          LIMIT 20`,
        [tenantId, workflowId],
      ),
      db.query<EscalationRow>(
        `SELECT id,
                work_item_id,
                reason,
                closure_effect,
                status
           FROM workflow_subject_escalations
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY created_at DESC
          LIMIT 20`,
        [tenantId, workflowId],
      ),
      db.query<ToolResultRow>(
        `SELECT mutation_outcome,
                recovery_class,
                response
           FROM workflow_tool_results
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND mutation_outcome IS NOT NULL
          ORDER BY created_at DESC
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
  const focus = selectClosureContextFocus(task, activationRes.rows, serializedWorkItems);
  const pendingDispatches = derivePendingDispatches(serializedWorkItems, serializedTasks, definition);
  const closureContext = buildClosureContext({
    definition,
    lifecycle,
    workItems: serializedWorkItems,
    tasks: serializedTasks,
    stageGates: stageGatesRes.rows,
    escalations: escalationsRes.rows,
    toolResults: toolResultsRes.rows,
    focusWorkItemId: focus.workItemId,
    focusStageName: focus.stageName,
  });
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
    closure_context: closureContext,
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

function buildClosureContext(params: {
  definition: ReturnType<typeof parsePlaybookDefinition>;
  lifecycle: 'planned' | 'ongoing';
  workItems: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  stageGates: StageGateRow[];
  escalations: EscalationRow[];
  toolResults: ToolResultRow[];
  focusWorkItemId: string | null;
  focusStageName: string | null;
}): GuidedClosureContext {
  const focusedWorkItem = selectFocusedWorkItemForClosure(params.workItems, params.focusWorkItemId, params.focusStageName);
  const focusedStageName = readOptionalString(focusedWorkItem.stage_name) ?? params.focusStageName;
  const focusedWorkItemId = readOptionalString(focusedWorkItem.id) ?? params.focusWorkItemId;
  const currentSubjectRevision = readOptionalPositiveInteger(focusedWorkItem.current_subject_revision);
  const stage = focusedStageName
    ? params.definition.stages.find((entry) => entry.name === focusedStageName) ?? null
    : null;
  const stageRoles = (stage?.involves ?? [])
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
  const roleCoverage = buildStageRoleCoverage({
    stageName: focusedStageName,
    stageRoles,
    workItemId: focusedWorkItemId,
    currentSubjectRevision,
    tasks: params.tasks,
  });

  const activeBlockingControls = [
    ...summarizeStageGates(params.stageGates, focusedStageName, focusedWorkItemId, 'blocking'),
    ...summarizeEscalations(params.escalations, focusedWorkItemId, 'blocking'),
  ];
  const activeAdvisoryControls = [
    ...summarizeStageGates(params.stageGates, focusedStageName, focusedWorkItemId, 'advisory'),
    ...summarizeEscalations(params.escalations, focusedWorkItemId, 'advisory'),
  ];
  const preferredObligations = roleCoverage
    .filter((entry) => entry.status === 'missing' || entry.status === 'older_assessment')
    .map((entry) => ({
      code: 'stage_role_contribution' as const,
      status: 'unmet' as const,
      subject: entry.role,
    }));
  const recentRecoveryOutcomes = params.toolResults
    .filter((row) => row.mutation_outcome && row.mutation_outcome !== 'applied' && row.recovery_class)
    .slice(0, 5)
    .map((row) => ({
      recovery_class: row.recovery_class as string,
      suggested_next_actions: normalizeSuggestedNextActions(asRecord(row.response).suggested_next_actions),
    }));
  const specialistTasks = params.tasks.filter((row) => row.is_orchestrator_task !== true);
  const attemptCountByWorkItem = countAttemptsByKey(
    specialistTasks.map((row) => readOptionalString(row.work_item_id)).filter((value): value is string => Boolean(value)),
  );
  const attemptCountByRole = countAttemptsByKey(
    specialistTasks.map((row) => readOptionalString(row.role)).filter((value): value is string => Boolean(value)),
  );
  const recentFailures = specialistTasks
    .filter((row) => isFailureState(readOptionalString(row.state)))
    .map((row) => ({
      task_id: readOptionalString(row.id) ?? 'unknown-task',
      role: readOptionalString(row.role),
      state: readOptionalString(row.state) ?? 'failed',
      why: readFailureReason(row),
    }))
    .filter((row) => row.why.length > 0)
    .slice(0, 10);
  const retryTask = specialistTasks.find((row) => {
    const retryAvailableAt = readOptionalString(asRecord(row.metadata).retry_available_at);
    return Boolean(retryAvailableAt) && isFailureState(readOptionalString(row.state));
  });
  const retryMetadata = retryTask ? asRecord(retryTask.metadata) : {};
  const retryWindow = readOptionalString(retryMetadata.retry_available_at)
    ? {
        retry_available_at: readOptionalString(retryMetadata.retry_available_at) as string,
        backoff_seconds: readOptionalNumber(retryMetadata.retry_backoff_seconds) ?? 0,
      }
    : null;
  const lastRetryReason = retryTask ? readFailureReason(retryTask) : recentFailures[0]?.why ?? null;
  const rerouteCandidates = Array.from(
    new Set(
      [
        ...preferredObligations.map((entry) => entry.subject),
        ...recentFailures.map((entry) => entry.role).filter((value): value is string => Boolean(value)),
      ].filter((value) => value.length > 0),
    ),
  );
  const focusedOpenSpecialistTasks = specialistTasks.filter(
    (row) =>
      readOptionalString(row.work_item_id) === focusedWorkItemId
      && isOpenSpecialistTask(row),
  );
  const workItemCanCloseNow = activeBlockingControls.length === 0 && focusedOpenSpecialistTasks.length === 0;
  const workflowCanCloseNow = params.workItems.every((row) => row.completed_at !== null && row.completed_at !== undefined)
    && specialistTasks.every((row) => !isOpenSpecialistTask(row))
    && activeBlockingControls.length === 0;
  const closureReadiness = activeBlockingControls.length > 0
    ? 'blocked'
    : activeAdvisoryControls.length > 0 || preferredObligations.length > 0
      ? 'can_close_with_callouts'
      : workItemCanCloseNow
        ? 'ready_to_close'
        : 'not_ready';

  return guidedClosureContextSchema.parse({
    workflow_can_close_now: workflowCanCloseNow,
    work_item_can_close_now: workItemCanCloseNow,
    active_blocking_controls: activeBlockingControls,
    active_advisory_controls: activeAdvisoryControls,
    preferred_obligations: preferredObligations,
    closure_readiness: closureReadiness,
    recent_recovery_outcomes: recentRecoveryOutcomes,
    attempt_count_by_work_item: attemptCountByWorkItem,
    attempt_count_by_role: attemptCountByRole,
    recent_failures: recentFailures,
    last_retry_reason: lastRetryReason,
    retry_window: retryWindow,
    reroute_candidates: rerouteCandidates,
  });
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

function selectClosureContextFocus(
  task: Record<string, unknown>,
  activationRows: ActivationRow[],
  workItems: Record<string, unknown>[],
) {
  const activationPayload = asRecord(activationRows[0]?.payload);
  const workItemId = readOptionalString(task.work_item_id)
    ?? readOptionalString(activationPayload.work_item_id)
    ?? readOptionalString(workItems[0]?.id);
  const stageName = readOptionalString(task.stage_name)
    ?? readOptionalString(activationPayload.stage_name)
    ?? readOptionalString(
      workItems.find((row) => readOptionalString(row.id) === workItemId)?.stage_name,
    )
    ?? readOptionalString(workItems[0]?.stage_name);
  return { workItemId, stageName };
}

function selectFocusedWorkItemForClosure(
  workItems: Record<string, unknown>[],
  workItemId: string | null,
  stageName: string | null,
) {
  if (workItemId) {
    const exact = workItems.find((row) => readOptionalString(row.id) === workItemId);
    if (exact) {
      return exact;
    }
  }
  if (stageName) {
    const stageMatch = workItems.find((row) => readOptionalString(row.stage_name) === stageName);
    if (stageMatch) {
      return stageMatch;
    }
  }
  return workItems[0] ?? {};
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

function summarizeStageGates(
  rows: StageGateRow[],
  stageName: string | null,
  workItemId: string | null,
  closureEffect: 'blocking' | 'advisory',
) {
  return rows
    .filter((row) => (row.status ?? 'awaiting_approval') === 'awaiting_approval')
    .filter((row) => normalizeClosureEffect(row.closure_effect) === closureEffect)
    .filter((row) => !stageName || row.stage_name === stageName)
    .filter((row) => !workItemId || !row.requested_by_work_item_id || row.requested_by_work_item_id === workItemId)
    .map((row) => ({
      kind: 'approval',
      id: row.id,
      closure_effect: closureEffect,
      summary: row.request_summary ?? `Approval remains ${closureEffect}.`,
    }));
}

function summarizeEscalations(
  rows: EscalationRow[],
  workItemId: string | null,
  closureEffect: 'blocking' | 'advisory',
) {
  return rows
    .filter((row) => (row.status ?? 'open') === 'open')
    .filter((row) => normalizeClosureEffect(row.closure_effect) === closureEffect)
    .filter((row) => !workItemId || !row.work_item_id || row.work_item_id === workItemId)
    .map((row) => ({
      kind: 'escalation',
      id: row.id,
      closure_effect: closureEffect,
      summary: row.reason,
    }));
}

function normalizeSuggestedNextActions(value: unknown): GuidedClosureSuggestedAction[] {
  const entries = Array.isArray(value) ? value : [];
  return entries
    .map((entry) => asRecord(entry))
    .filter((entry) =>
      typeof entry.action_code === 'string'
      && typeof entry.target_type === 'string'
      && typeof entry.target_id === 'string'
      && typeof entry.why === 'string'
      && typeof entry.requires_orchestrator_judgment === 'boolean',
    )
    .map((entry) => ({
      action_code: entry.action_code as string,
      target_type: entry.target_type as string,
      target_id: entry.target_id as string,
      why: entry.why as string,
      requires_orchestrator_judgment: entry.requires_orchestrator_judgment as boolean,
    }));
}

function countAttemptsByKey(values: string[]) {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function isFailureState(state: string | null) {
  return state === 'failed' || state === 'escalated' || state === 'cancelled';
}

function readFailureReason(task: Record<string, unknown>) {
  const metadata = asRecord(task.metadata);
  return readOptionalString(metadata.retry_last_error)
    ?? readOptionalString(asRecord(task.error).message)
    ?? readOptionalString(asRecord(task.error).error)
    ?? 'task failed without a structured reason';
}

function normalizeClosureEffect(value: string | null) {
  return value === 'advisory' ? 'advisory' : 'blocking';
}

function derivePendingDispatches(
  workItems: Record<string, unknown>[],
  tasks: Record<string, unknown>[],
  definition: ReturnType<typeof parsePlaybookDefinition>,
): PendingDispatch[] {
  void definition;
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

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
