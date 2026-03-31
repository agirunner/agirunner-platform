import type { DatabaseQueryable } from '../../db/database.js';
import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';

export interface ActivationRow {
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

export interface WorkflowRow {
  id: string;
  name: string;
  lifecycle: string | null;
  metadata: Record<string, unknown> | null;
  playbook_name: string;
  playbook_outcome: string | null;
  playbook_definition: Record<string, unknown>;
}

export interface PlaybookRoleDefinitionRow {
  name: string;
  description: string | null;
}

export interface PendingDispatch {
  work_item_id: string;
  stage_name: string | null;
  actor: string;
  action: string;
  title: string | null;
}

export interface StageGateRow {
  id: string;
  stage_name: string;
  status: string;
  closure_effect: string | null;
  requested_by_work_item_id: string | null;
  request_summary: string | null;
}

export interface EscalationRow {
  id: string;
  work_item_id: string | null;
  reason: string;
  closure_effect: string | null;
  status: string;
}

export interface ToolResultRow {
  mutation_outcome: string | null;
  recovery_class: string | null;
  response: Record<string, unknown> | null;
}

export function serializeActivation(row: ActivationRow) {
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

export function serializeActivationBatch(activationId: string, rows: ActivationRow[]) {
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

export function serializeDates(row: Record<string, unknown>) {
  const serialized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    serialized[key] = value instanceof Date ? value.toISOString() : value;
  }
  return serialized;
}

export function serializeWorkItem(row: Record<string, unknown>) {
  const serialized = serializeDates(row);
  const continuity = asRecord(asRecord(serialized.metadata).orchestrator_finish_state);
  return {
    ...serialized,
    stage_name: typeof serialized.stage_name === 'string' ? serialized.stage_name : null,
    continuity: Object.keys(continuity).length > 0 ? continuity : null,
  };
}

export function selectClosureContextFocus(
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

export function selectFocusedWorkItemForClosure(
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

export function activeStageNames(rows: Record<string, unknown>[]): string[] {
  return Array.from(
    new Set(
      rows
        .filter((row) => row.completed_at == null && typeof row.stage_name === 'string')
        .map((row) => String(row.stage_name)),
    ),
  );
}

export async function loadPlaybookRoleDefinitions(
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

export function derivePendingDispatches(
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

export function hasOpenChildAssessmentDispatchOwner(
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

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function readOptionalPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

export function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

export function isOpenSpecialistTask(task: Record<string, unknown>): boolean {
  const state = readOptionalString(task.state);
  return state === 'ready'
    || state === 'claimed'
    || state === 'in_progress'
    || state === 'awaiting_approval'
    || state === 'output_pending_assessment';
}
