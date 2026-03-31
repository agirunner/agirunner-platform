
import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import { parsePlaybookDefinition, type PlaybookDefinition } from '../../orchestration/playbook-model.js';
import { completionCalloutsSchema } from '../guided-closure/types.js';
import { areJsonValuesEquivalent } from '../json-equivalence.js';
import type {
  Dependencies,
  NormalizedWorkItemUpdate,
  StageGateDecisionInput,
  StageGateRequestInput,
  UpdateWorkflowWorkItemInput,
  WorkflowContextRow,
  WorkflowStageGateRow,
  WorkflowStageRow,
  WorkflowWorkItemResponse,
  WorkflowWorkItemRow,
} from './playbook-workflow-control-types.js';

export function nextStageNameFor(definition: PlaybookDefinition, currentStageName: string): string | null {
  const index = definition.stages.findIndex((stage) => stage.name === currentStageName);
  if (index === -1) {
    return null;
  }
  return definition.stages[index + 1]?.name ?? null;
}

export function nullableText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function parseOptionalTimestamp(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeConcernList(value?: string[]) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function normalizeArtifactList(
  value?: Array<{ id?: string; task_id?: string; label?: string; path?: string }>,
) {
  if (!Array.isArray(value)) {
    return [] as Array<Record<string, string>>;
  }
  return value
    .map((artifact) => {
      const normalized = {
        ...(artifact.id?.trim() ? { id: artifact.id.trim() } : {}),
        ...(artifact.task_id?.trim() ? { task_id: artifact.task_id.trim() } : {}),
        ...(artifact.label?.trim() ? { label: artifact.label.trim() } : {}),
        ...(artifact.path?.trim() ? { path: artifact.path.trim() } : {}),
      };
      return normalized;
    })
    .filter((artifact) => Object.keys(artifact).length > 0);
}

export function gateArtifactTaskIds(value: unknown) {
  const ids = new Set<string>();
  for (const artifact of normalizeRecordArray(value)) {
    const taskId = typeof artifact.task_id === 'string' ? artifact.task_id.trim() : '';
    if (taskId) {
      ids.add(taskId);
    }
  }
  return [...ids];
}

export function singleResolvedOwnerRole(targets: Array<{ owner_role: string | null }>) {
  const roles = [...new Set(
    targets
      .map((target) => target.owner_role)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  )];
  return roles.length === 1 ? roles[0] : null;
}

export function nullableTextOrNull(value: string | null | undefined, fallback: string | null): string | null {
  return value === undefined ? fallback : nullableText(value);
}

export function isIdempotentGateDecision(
  gate: WorkflowStageGateRow | null,
  input: StageGateDecisionInput,
) {
  if (!gate) {
    return false;
  }
  return gate.status === gateStatusForAction(input.action);
}

export function isFollowOnGateDecisionAllowed(
  gate: WorkflowStageGateRow | null,
  input: StageGateDecisionInput,
) {
  if (!gate) {
    return false;
  }
  return gate.status === 'changes_requested' && input.action === 'approve';
}

export function isIdempotentGateRequest(
  gate: WorkflowStageGateRow,
  input: StageGateRequestInput,
) {
  return gate.status === 'awaiting_approval'
    && gate.request_summary === input.summary.trim()
    && gate.recommendation === nullableText(input.recommendation)
    && sameStringArray(normalizeConcernList(input.concerns), normalizeStringArray(gate.concerns))
    && sameRecordArray(normalizeArtifactList(input.key_artifacts), normalizeRecordArray(gate.key_artifacts));
}

export function isIdempotentStageAdvance(
  currentStageName: string | null,
  sourceStage: WorkflowStageRow,
  nextStageName: string,
) {
  return Boolean(currentStageName) && currentStageName === nextStageName;
}

export function terminalColumnIdFor(definition: ReturnType<typeof parsePlaybookDefinition>) {
  const terminalColumn = definition.board.columns.find((column) => column.is_terminal);
  return terminalColumn ? terminalColumn.id : null;
}

export function readCompletionSummary(workflow: WorkflowContextRow) {
  const state = workflow.orchestration_state;
  if (!state || typeof state !== 'object') {
    return null;
  }
  const value = state.completion_summary;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function readCompletionArtifacts(workflow: WorkflowContextRow) {
  const state = workflow.orchestration_state;
  if (!state || typeof state !== 'object') {
    return [] as string[];
  }
  return normalizeStringArray(state.final_artifacts);
}

export function readWorkflowCompletionCallouts(workflow: WorkflowContextRow) {
  return completionCalloutsSchema.parse(workflow.completion_callouts ?? {});
}

export function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function normalizeRecordArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Array<Record<string, string>>;
  }
  return value.filter(
    (entry): entry is Record<string, string> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  );
}

export function sameStringArray(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export function isAdvisoryContinuationAction(action: string) {
  return action === 'approve' || action === 'assess';
}

export function sameRecordArray(
  left: Array<Record<string, string>>,
  right: Array<Record<string, string>>,
) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => areJsonValuesEquivalent(value, right[index]));
}

export function gateStatusForAction(action: StageGateDecisionInput['action']) {
  return action === 'approve'
    ? 'approved'
    : action === 'request_changes'
      ? 'changes_requested'
      : action === 'block'
        ? 'blocked'
        : 'rejected';
}

export function mergeRecord(
  current: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown> | null | undefined,
) {
  return {
    ...(current ?? {}),
    ...(patch ?? {}),
  };
}

export function stripOrchestratorFinishState(metadata: Record<string, unknown>) {
  const nextMetadata = { ...metadata };
  delete nextMetadata.orchestrator_finish_state;
  return nextMetadata;
}

export function normalizeWorkItemUpdate(
  current: WorkflowWorkItemRow,
  input: UpdateWorkflowWorkItemInput,
  resolved: {
    parentWorkItemId: string | null;
    stageName: string;
    columnId: string;
    terminalColumns: Set<string>;
  },
): NormalizedWorkItemUpdate {
  const isTerminal = resolved.terminalColumns.has(resolved.columnId);
  return {
    parent_work_item_id: resolved.parentWorkItemId,
    title: input.title?.trim() || current.title,
    goal: nullableTextOrNull(input.goal, current.goal),
    acceptance_criteria: nullableTextOrNull(input.acceptance_criteria, current.acceptance_criteria),
    stage_name: resolved.stageName,
    column_id: resolved.columnId,
    owner_role: nullableTextOrNull(input.owner_role, current.owner_role),
    next_expected_actor: isTerminal ? null : current.next_expected_actor,
    next_expected_action: isTerminal ? null : current.next_expected_action,
    priority: input.priority ?? current.priority,
    notes: nullableTextOrNull(input.notes, current.notes),
    completed_at: isTerminal ? current.completed_at ?? new Date() : null,
    metadata: isTerminal
      ? stripOrchestratorFinishState(mergeRecord(current.metadata, input.metadata))
      : mergeRecord(current.metadata, input.metadata),
  };
}

export function sameNormalizedWorkItem(
  current: WorkflowWorkItemRow,
  next: NormalizedWorkItemUpdate,
) {
  return current.parent_work_item_id === next.parent_work_item_id
    && current.title === next.title
    && current.goal === next.goal
    && current.acceptance_criteria === next.acceptance_criteria
    && current.stage_name === next.stage_name
    && current.column_id === next.column_id
    && current.owner_role === next.owner_role
    && current.next_expected_actor === next.next_expected_actor
    && current.next_expected_action === next.next_expected_action
    && current.priority === next.priority
    && current.notes === next.notes
    && sameCompletionState(current.completed_at, next.completed_at)
    && areJsonValuesEquivalent(current.metadata ?? {}, next.metadata);
}

function sameCompletionState(left: Date | null, right: Date | null) {
  return (left === null) === (right === null);
}

export function buildWorkItemUpdatePayload(previous: WorkflowWorkItemRow, current: WorkflowWorkItemRow) {
  return {
    work_item_id: current.id,
    previous_parent_work_item_id: previous.parent_work_item_id,
    parent_work_item_id: current.parent_work_item_id,
    previous_stage_name: previous.stage_name,
    stage_name: current.stage_name,
    previous_column_id: previous.column_id,
    column_id: current.column_id,
    completed_at: current.completed_at?.toISOString() ?? null,
  };
}

export function toWorkItemResponse(row: WorkflowWorkItemRow): WorkflowWorkItemResponse {
  return {
    ...row,
    completion_callouts: completionCalloutsSchema.parse(row.completion_callouts ?? {}),
    completed_at: row.completed_at?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
  };
}

export function toStageResponse(row: WorkflowStageRow) {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    goal: row.goal,
    guidance: row.guidance,
    status: row.status,
    gate_status: row.gate_status,
    iteration_count: row.iteration_count,
    summary: row.summary,
    metadata: row.metadata ?? {},
    started_at: row.started_at?.toISOString() ?? null,
    completed_at: row.completed_at?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
  };
}

export function toStageDecisionResponse(
  row: WorkflowStageRow,
  activation?: Record<string, unknown> | null,
) {
  const stage = toStageResponse(row);
  if (!activation) {
    return stage;
  }
  return {
    ...stage,
    orchestrator_resume: {
      activation_id: activation.activation_id ?? activation.id ?? null,
      state: activation.state ?? null,
      event_type: activation.event_type ?? null,
      reason: activation.reason ?? null,
      queued_at: parseOptionalTimestamp(asString(activation.queued_at)),
      started_at: parseOptionalTimestamp(asString(activation.started_at)),
      completed_at: parseOptionalTimestamp(asString(activation.completed_at)),
      summary: activation.summary ?? null,
      error: activation.error ?? null,
    },
  };
}

export function describePendingContinuation(action: string) {
  switch (action) {
    case 'approve':
      return 'approval';
    case 'rework':
      return 'rework';
    case 'handoff':
      return 'handoff';
    default:
      return 'assessment';
  }
}

export function readOptionalMetadataNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }
  return null;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

export async function emitWorkItemEvent(
  deps: Dependencies,
  identity: ApiKeyIdentity,
  workflowId: string,
  workItemId: string,
  type: string,
  data: Record<string, unknown>,
  client: DatabaseClient,
) {
  await deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type,
      entityType: 'work_item',
      entityId: workItemId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {
        workflow_id: workflowId,
        ...data,
      },
    },
    client,
  );
}

export async function emitWorkItemUpdateEvents(
  deps: Dependencies,
  identity: ApiKeyIdentity,
  workflowId: string,
  previous: WorkflowWorkItemRow,
  current: WorkflowWorkItemRow,
  client: DatabaseClient,
) {
  const basePayload = buildWorkItemUpdatePayload(previous, current);
  await emitWorkItemEvent(deps, identity, workflowId, current.id, 'work_item.updated', basePayload, client);

  if (
    previous.stage_name !== current.stage_name ||
    previous.column_id !== current.column_id
  ) {
    await emitWorkItemEvent(deps, identity, workflowId, current.id, 'work_item.moved', basePayload, client);
  }

  if (previous.parent_work_item_id !== current.parent_work_item_id) {
    await emitWorkItemEvent(
      deps,
      identity,
      workflowId,
      current.id,
      'work_item.reparented',
      basePayload,
      client,
    );
  }

  if (!previous.completed_at && current.completed_at) {
    await emitWorkItemEvent(
      deps,
      identity,
      workflowId,
      current.id,
      'work_item.completed',
      basePayload,
      client,
    );
  }

  if (previous.completed_at && !current.completed_at) {
    await emitWorkItemEvent(
      deps,
      identity,
      workflowId,
      current.id,
      'work_item.reopened',
      basePayload,
      client,
    );
  }
}
