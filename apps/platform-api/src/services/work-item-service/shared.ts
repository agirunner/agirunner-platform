import type { ApiKeyIdentity } from '../../auth/api-key.js';
import { isOperatorScope } from '../../auth/scope.js';
import { ConflictError } from '../../errors/domain-errors.js';
import { defaultStageName, parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import { areJsonValuesEquivalent } from '../json-equivalence.js';
import { sanitizeSecretLikeValue } from '../secret-redaction.js';
import type {
  GroupedWorkItemReadModel,
  WorkItemReadModel,
} from './types.js';

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function resolveWorkItemStageName(
  inputStageName: string | undefined,
  _workflow: { lifecycle: string | null; active_stage_name: string | null },
  definition: ReturnType<typeof parsePlaybookDefinition>,
): string | null {
  if (inputStageName) {
    return inputStageName;
  }
  return defaultStageName(definition);
}

export function shouldAutoClosePredecessorCheckpoint(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  predecessorStageName: string | null,
  successorStageName: string,
) {
  if (!predecessorStageName || predecessorStageName === successorStageName) {
    return false;
  }

  const stageNames = definition.stages.map((stage) => stage.name);
  const predecessorIndex = stageNames.indexOf(predecessorStageName);
  const successorIndex = stageNames.indexOf(successorStageName);
  if (predecessorIndex < 0 || successorIndex < 0) {
    return false;
  }
  return successorIndex === predecessorIndex + 1;
}

export function nextStageNameFor(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  currentStageName: string | null,
) {
  if (!currentStageName) {
    return null;
  }
  const currentIndex = definition.stages.findIndex((stage) => stage.name === currentStageName);
  if (currentIndex < 0) {
    return null;
  }
  return definition.stages[currentIndex + 1]?.name ?? null;
}

export function shouldBlockSuccessorCheckpointForOpenTasks(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  predecessorStageName: string | null,
  taskStateCounts: Map<string, number>,
) {
  void definition;
  void predecessorStageName;
  return taskStateCounts.size > 0;
}

export function terminalColumnIdFor(definition: ReturnType<typeof parsePlaybookDefinition>) {
  return definition.board.columns.find((column) => column.is_terminal)?.id ?? null;
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

export function createdByForIdentity(identity: ApiKeyIdentity): 'api' | 'manual' | 'orchestrator' | 'webhook' {
  if (identity.ownerType === 'webhook_trigger' || identity.ownerType === 'scheduled_trigger') {
    return 'webhook';
  }
  if (identity.ownerType === 'agent') {
    return 'orchestrator';
  }
  return isOperatorScope(identity.scope) ? 'manual' : 'api';
}

export function actorTypeForIdentity(identity: ApiKeyIdentity): string {
  return identity.ownerType === 'webhook_trigger' || identity.ownerType === 'scheduled_trigger'
    ? 'system'
    : identity.scope;
}

export function toWorkItemReadModel(row: Record<string, unknown>): WorkItemReadModel {
  const sanitizedRow = sanitizeSecretLikeValue(row, {
    redactionValue: 'redacted://work-item-secret',
    allowSecretReferences: false,
  }) as Record<string, unknown>;
  const childrenCount = readCount(sanitizedRow.children_count);
  const completedAt =
    typeof sanitizedRow.completed_at === 'string' || sanitizedRow.completed_at instanceof Date
      ? sanitizedRow.completed_at
      : null;
  const completedWorkItem = completedAt !== null;
  return {
    ...sanitizedRow,
    id: String(sanitizedRow.id ?? ''),
    workflow_id: String(sanitizedRow.workflow_id ?? ''),
    parent_work_item_id: typeof sanitizedRow.parent_work_item_id === 'string' ? sanitizedRow.parent_work_item_id : null,
    branch_id: typeof sanitizedRow.branch_id === 'string' ? sanitizedRow.branch_id : null,
    branch_status:
      typeof sanitizedRow.branch_status === 'string'
        ? sanitizedRow.branch_status as WorkItemReadModel['branch_status']
        : null,
    stage_name: typeof sanitizedRow.stage_name === 'string' ? sanitizedRow.stage_name : null,
    column_id: typeof sanitizedRow.column_id === 'string' ? sanitizedRow.column_id : null,
    next_expected_actor:
      completedWorkItem
        ? null
        : typeof sanitizedRow.next_expected_actor === 'string'
          ? sanitizedRow.next_expected_actor
          : null,
    next_expected_action:
      completedWorkItem
        ? null
        : typeof sanitizedRow.next_expected_action === 'string'
          ? sanitizedRow.next_expected_action
          : null,
    blocked_state:
      typeof sanitizedRow.blocked_state === 'string'
        ? sanitizedRow.blocked_state as WorkItemReadModel['blocked_state']
        : null,
    blocked_reason:
      typeof sanitizedRow.blocked_reason === 'string'
        ? sanitizedRow.blocked_reason
        : null,
    escalation_status:
      typeof sanitizedRow.escalation_status === 'string'
        ? sanitizedRow.escalation_status as WorkItemReadModel['escalation_status']
        : null,
    rework_count: readCount(sanitizedRow.rework_count),
    latest_handoff_completion:
      typeof sanitizedRow.latest_handoff_completion === 'string'
        ? sanitizedRow.latest_handoff_completion
        : null,
    latest_handoff_resolution:
      typeof sanitizedRow.latest_handoff_resolution === 'string'
        ? sanitizedRow.latest_handoff_resolution
        : null,
    unresolved_findings: completedWorkItem ? [] : readStringArray(sanitizedRow.unresolved_findings),
    focus_areas: completedWorkItem ? [] : readStringArray(sanitizedRow.focus_areas),
    known_risks: readStringArray(sanitizedRow.known_risks),
    current_subject_revision: readOptionalCount(sanitizedRow.current_subject_revision),
    approved_assessment_count: readCount(sanitizedRow.approved_assessment_count),
    blocking_assessment_count: readCount(sanitizedRow.blocking_assessment_count),
    pending_assessment_count: readCount(sanitizedRow.pending_assessment_count),
    assessment_status:
      typeof sanitizedRow.assessment_status === 'string'
        ? sanitizedRow.assessment_status as WorkItemReadModel['assessment_status']
        : null,
    gate_status:
      typeof sanitizedRow.gate_status === 'string'
        ? sanitizedRow.gate_status
        : typeof sanitizedRow.stage_gate_status === 'string'
          ? sanitizedRow.stage_gate_status
          : null,
    gate_decision_feedback:
      typeof sanitizedRow.gate_decision_feedback === 'string'
        ? sanitizedRow.gate_decision_feedback
        : null,
    gate_decided_at:
      typeof sanitizedRow.gate_decided_at === 'string' || sanitizedRow.gate_decided_at instanceof Date
        ? sanitizedRow.gate_decided_at
        : null,
    completed_at: completedAt,
    task_count: readCount(sanitizedRow.task_count),
    children_count: childrenCount,
    children_completed: readCount(sanitizedRow.children_completed),
    is_milestone: childrenCount > 0,
  } as WorkItemReadModel;
}

export function groupWorkItems(workItems: WorkItemReadModel[]): GroupedWorkItemReadModel[] {
  const grouped = new Map<string, GroupedWorkItemReadModel>();
  const roots: GroupedWorkItemReadModel[] = [];

  for (const item of workItems) {
    grouped.set(String(item.id), { ...item });
  }

  for (const item of grouped.values()) {
    const parentId = typeof item.parent_work_item_id === 'string' ? item.parent_work_item_id : null;
    if (!parentId) {
      roots.push(item);
      continue;
    }
    const parent = grouped.get(parentId);
    if (!parent) {
      roots.push(item);
      continue;
    }
    const existingChildren = Array.isArray(parent.children)
      ? (parent.children as WorkItemReadModel[])
      : [];
    const children = [...existingChildren, item] as WorkItemReadModel[];
    parent.children = children;
  }

  return roots;
}

export function readCount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function readOptionalCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

export function assertMatchingCreateWorkItemReplay(
  existing: Record<string, unknown>,
  expected: {
    parent_work_item_id: string | null;
    branch_id: string | null;
    stage_name: string;
    title: string;
    goal: string | null;
    acceptance_criteria: string | null;
    column_id: string;
    owner_role: string | null;
    priority: string;
    notes: string | null;
    metadata: Record<string, unknown>;
  },
): void {
  if (
    (existing.parent_work_item_id ?? null) !== expected.parent_work_item_id ||
    (existing.branch_id ?? null) !== expected.branch_id ||
    existing.stage_name !== expected.stage_name ||
    existing.title !== expected.title ||
    (existing.goal ?? null) !== expected.goal ||
    (existing.acceptance_criteria ?? null) !== expected.acceptance_criteria ||
    existing.column_id !== expected.column_id ||
    (existing.owner_role ?? null) !== expected.owner_role ||
    existing.priority !== expected.priority ||
    (existing.notes ?? null) !== expected.notes ||
    !areJsonValuesEquivalent(asRecord(existing.metadata), expected.metadata)
  ) {
    throw new ConflictError('work item request_id replay does not match the existing work item');
  }
}

export function matchesReusablePlannedChildCheckpoint(
  existing: Record<string, unknown>,
  stageName: string,
  ownerRole: string | null,
  expected: {
    title: string;
    goal?: string;
    acceptance_criteria?: string;
    column_id: string;
    priority: string;
    notes?: string;
    metadata?: Record<string, unknown>;
  },
): boolean {
  return (
    existing.stage_name === stageName
    && (existing.owner_role ?? null) === ownerRole
    && existing.title === expected.title
    && existing.column_id === expected.column_id
    && existing.priority === expected.priority
    && (expected.goal === undefined || (existing.goal ?? null) === expected.goal)
    && (
      expected.acceptance_criteria === undefined
      || (existing.acceptance_criteria ?? null) === expected.acceptance_criteria
    )
    && (expected.notes === undefined || (existing.notes ?? null) === expected.notes)
    && (expected.metadata === undefined || areJsonValuesEquivalent(asRecord(existing.metadata), expected.metadata))
  );
}

export function shouldResetReusableChildCheckpoint(workItem: Record<string, unknown>) {
  const metadata = asRecord(workItem.metadata);
  return Boolean(
    (typeof workItem.next_expected_actor === 'string' && workItem.next_expected_actor.length > 0)
    || (typeof workItem.next_expected_action === 'string' && workItem.next_expected_action.length > 0)
    || metadata.orchestrator_finish_state,
  );
}

export function starterRolesForPlannedStage(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  stageName: string,
) {
  const stage = definition.stages.find((entry) => entry.name === stageName);
  void definition;
  return stage?.involves?.filter((role) => role.trim().length > 0) ?? [];
}
