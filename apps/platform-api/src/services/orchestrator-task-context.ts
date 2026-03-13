import type { DatabaseQueryable } from '../db/database.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import {
  currentStageNameFromStages,
  isActiveStageStatus,
  normalizeWorkflowStageView,
  type WorkflowStageResponse,
  type WorkflowStageViewInput,
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

export async function buildOrchestratorTaskContext(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
) {
  if (!task.is_orchestrator_task || !task.workflow_id) {
    return null;
  }

  const workflowId = String(task.workflow_id);
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
                priority,
                completed_at,
                notes
           FROM workflow_work_items
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY created_at ASC`,
        [tenantId, workflowId],
      ),
      db.query<WorkflowStageViewInput>(
        `SELECT ws.id,
                w.lifecycle,
                ws.name,
                ws.position,
                ws.goal,
                ws.guidance,
                ws.human_gate,
                ws.status,
                ws.gate_status,
                ws.iteration_count,
                ws.summary,
                ws.started_at,
                ws.completed_at,
                COALESCE(work_item_summary.open_work_item_count, 0) AS open_work_item_count,
                COALESCE(work_item_summary.total_work_item_count, 0) AS total_work_item_count,
                work_item_summary.first_work_item_at,
                work_item_summary.last_completed_work_item_at
           FROM workflow_stages ws
           JOIN workflows w
             ON w.tenant_id = ws.tenant_id
            AND w.id = ws.workflow_id
           LEFT JOIN LATERAL (
             SELECT COUNT(*) FILTER (WHERE wi.completed_at IS NULL)::int AS open_work_item_count,
                    COUNT(*)::int AS total_work_item_count,
                    MIN(wi.created_at) AS first_work_item_at,
                    MAX(wi.completed_at) AS last_completed_work_item_at
               FROM workflow_work_items wi
              WHERE wi.tenant_id = ws.tenant_id
                AND wi.workflow_id = ws.workflow_id
                AND wi.stage_name = ws.name
           ) AS work_item_summary
             ON true
          WHERE ws.tenant_id = $1
            AND ws.workflow_id = $2
          ORDER BY ws.position ASC`,
        [tenantId, workflowId],
      ),
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
                is_orchestrator_task
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
  const stageRows = stagesRes.rows.map(normalizeWorkflowStageView);
  const activeStages = activeStageNames(workItemsRes.rows);
  const currentStage = currentStageNameFromStages(stageRows);
  const lifecycle = workflow.lifecycle === 'continuous' ? 'continuous' : 'standard';
  const workflowContext = {
    id: workflow.id,
    name: workflow.name,
    lifecycle: workflow.lifecycle,
    active_stages: mergeActiveStageNames(
      lifecycle,
      activeStages,
      stageRows,
      workflow.playbook_definition,
    ),
    metadata: workflow.metadata ?? {},
    playbook: {
      name: workflow.playbook_name,
      outcome: workflow.playbook_outcome,
      definition: workflow.playbook_definition,
    },
  } as Record<string, unknown>;
  if (workflow.lifecycle !== 'continuous') {
    workflowContext.current_stage = currentStage;
  }

  return {
    activation: activationRes.rows[0] ? serializeActivationBatch(activationId ?? activationRes.rows[0].id, activationRes.rows) : null,
    workflow: workflowContext,
    board: {
      work_items: workItemsRes.rows.map(serializeDates),
      stages: stageRows,
      tasks: tasksRes.rows.map(serializeDates),
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

function activeStageNames(rows: Record<string, unknown>[]): string[] {
  return Array.from(
    new Set(
      rows
        .filter((row) => row.completed_at == null && typeof row.stage_name === 'string')
        .map((row) => String(row.stage_name)),
    ),
  );
}

function mergeActiveStageNames(
  lifecycle: 'continuous' | 'standard',
  workItemStages: string[],
  stageRows: Array<Pick<WorkflowStageResponse, 'name' | 'status'>>,
  definition: unknown,
): string[] {
  if (lifecycle === 'continuous') {
    return orderStageNamesByDefinition(workItemStages, definition);
  }
  const gateStages = stageRows
    .filter((row) => isActiveStageStatus(row.status))
    .map((row) => row.name);
  return orderStageNamesByDefinition(Array.from(new Set([...workItemStages, ...gateStages])), definition);
}

function orderStageNamesByDefinition(stageNames: string[], definition: unknown): string[] {
  if (stageNames.length <= 1) {
    return stageNames;
  }
  const stageOrder = readPlaybookStageOrder(definition);
  if (stageOrder.length === 0) {
    return stageNames;
  }
  const remaining = new Set(stageNames);
  const ordered: string[] = [];
  for (const stageName of stageOrder) {
    if (!remaining.has(stageName)) {
      continue;
    }
    ordered.push(stageName);
    remaining.delete(stageName);
  }
  for (const stageName of stageNames) {
    if (!remaining.has(stageName)) {
      continue;
    }
    ordered.push(stageName);
    remaining.delete(stageName);
  }
  return ordered;
}

function readPlaybookStageOrder(definition: unknown): string[] {
  try {
    return parsePlaybookDefinition(definition).stages.map((stage) => stage.name);
  } catch {
    return [];
  }
}
