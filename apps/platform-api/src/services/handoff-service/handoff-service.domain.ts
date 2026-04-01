import { ConflictError, ValidationError } from '../../errors/domain-errors.js';
import {
  readAssessmentSubjectLinkage,
  readWorkflowTaskKind,
} from '../workflow-task-policy/assessment-subject-service.js';
import {
  PLATFORM_HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_ID,
  mustGetSafetynetEntry,
} from '../safetynet/registry.js';
import { logSafetynetTriggered } from '../safetynet/logging.js';
import type {
  HandoffOutcomeAction,
  SubmitTaskHandoffInput,
  TaskContextRow,
} from './handoff-service.types.js';
import {
  compactRecord,
  normalizeArray,
  normalizeCompletionCallouts,
  normalizeRecommendedNextActions,
  normalizeStringArray,
  normalizeWaivedSteps,
  readInteger,
  readOptionalPositiveInteger,
  readOptionalString,
  sanitizeHandoffRecord,
  sanitizeHandoffValue,
  normalizeRecord,
} from './handoff-service.response.js';
import {
  assertNoTaskLocalHandoffPaths,
  normalizeTaskLocalHandoffReferences,
} from './handoff-service.paths.js';

const HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_ID,
);

export function assertHandoffStateAllowed(
  task: TaskContextRow,
  payload: ReturnType<typeof buildNormalizedHandoffPayload>,
) {
  if (!allowsHandoffResolution(task)) {
    if (!payload.decision_state && !payload.outcome_action_applied && !payload.closure_effect) {
      return;
    }
    throw new ValidationError('resolution, outcome_action_applied, and closure_effect are only allowed on assessment or approval handoffs');
  }
  if (payload.completion_state === 'full' && !payload.decision_state) {
    throw new ValidationError('resolution is required on full assessment or approval handoffs');
  }
  if (payload.completion_state === 'blocked' && payload.decision_state) {
    throw new ValidationError('decision_state is only allowed when completion_state is full');
  }
  if (payload.completion_state !== 'full' && (payload.outcome_action_applied || payload.closure_effect)) {
    throw new ValidationError('outcome_action_applied and closure_effect are only allowed when completion_state is full');
  }
}

export function buildNormalizedHandoffPayload(task: TaskContextRow, input: SubmitTaskHandoffInput) {
  const taskReworkCount = input.task_rework_count ?? readInteger(task.rework_count) ?? 0;
  const summary = sanitizeHandoffValue(input.summary.trim());
  const state = normalizeHandoffStates(input);
  const branchId = normalizeUUIDString(input.branch_id ?? input.role_data?.branch_id ?? task.metadata?.branch_id);
  const roleData = buildSystemOwnedRoleData(task, input, branchId);
  const subjectRef = resolveSubjectRef(input, roleData, branchId);
  const subjectRevision = resolveSubjectRevision(input, roleData);
  const payload = {
    task_rework_count: taskReworkCount,
    request_id: input.request_id?.trim() || null,
    role: task.role?.trim() || 'specialist',
    team_name: readOptionalString(task.metadata?.team_name),
    stage_name: task.stage_name?.trim() || null,
    summary: typeof summary === 'string' ? summary : input.summary.trim(),
    completion: state.completion_state,
    completion_state: state.completion_state,
    resolution: state.decision_state,
    decision_state: state.decision_state,
    closure_effect: normalizeClosureEffect(input.closure_effect ?? input.role_data?.closure_effect),
    changes: normalizeArray(sanitizeHandoffValue(input.changes)),
    decisions: normalizeArray(sanitizeHandoffValue(input.decisions)),
    remaining_items: normalizeArray(sanitizeHandoffValue(input.remaining_items)),
    blockers: normalizeArray(sanitizeHandoffValue(input.blockers)),
    focus_areas: normalizeStringArray(sanitizeHandoffValue(input.focus_areas)),
    known_risks: normalizeStringArray(sanitizeHandoffValue(input.known_risks)),
    recommended_next_actions: normalizeRecommendedNextActions(input.recommended_next_actions),
    waived_steps: normalizeWaivedSteps(input.waived_steps, input.completion_callouts),
    completion_callouts: normalizeCompletionCallouts(input.completion_callouts, input.waived_steps),
    successor_context: readOptionalString(sanitizeHandoffValue(input.successor_context)),
    role_data: roleData,
    subject_ref: subjectRef,
    subject_revision: subjectRevision,
    outcome_action_applied: normalizeOutcomeActionApplied(input.outcome_action_applied),
    branch_id: branchId,
    artifact_ids: normalizeStringArray(input.artifact_ids),
  };
  const repairedPayload = normalizeTaskLocalHandoffReferences(payload);
  if (repairedPayload.wasRepaired) {
    logSafetynetTriggered(
      HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_SAFETYNET,
      'task-local handoff references repaired to stable operator-facing references',
      { task_id: task.id, workflow_id: task.workflow_id },
    );
  }
  assertNoTaskLocalHandoffPaths(repairedPayload.payload);
  return repairedPayload.payload;
}

export function applyActivationEventAnchor(task: TaskContextRow): TaskContextRow {
  if (task.work_item_id) {
    return task;
  }
  const activationAnchor = readActivationEventAnchor(task.input);
  if (!activationAnchor.work_item_id && !activationAnchor.stage_name) {
    return task;
  }
  return {
    ...task,
    work_item_id: activationAnchor.work_item_id ?? task.work_item_id,
    stage_name: activationAnchor.stage_name ?? task.stage_name,
  };
}

export function assertMatchingTaskAttempt(task: TaskContextRow, input: SubmitTaskHandoffInput) {
  if (input.task_rework_count === undefined) {
    return;
  }
  const currentTaskReworkCount = readInteger(task.rework_count) ?? 0;
  if (input.task_rework_count === currentTaskReworkCount) {
    return;
  }
  throw new ConflictError('task handoff submission does not match the current task rework attempt');
}

export function normalizeHandoffResolution(
  value: unknown,
): 'approved' | 'request_changes' | 'rejected' | 'blocked' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'approved'
    || normalized === 'request_changes'
    || normalized === 'rejected'
    || normalized === 'blocked'
    ? normalized
    : null;
}

export function normalizeCompletionState(value: unknown): 'full' | 'blocked' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'full' || normalized === 'blocked' ? normalized : null;
}

export function normalizeClosureEffect(value: unknown): 'blocking' | 'advisory' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'blocking' || normalized === 'advisory' ? normalized : null;
}

export function normalizeOutcomeActionApplied(value: unknown): HandoffOutcomeAction | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'reopen_subject'
    || normalized === 'route_to_role'
    || normalized === 'block_subject'
    || normalized === 'escalate'
    || normalized === 'terminate_branch'
  ) {
    return normalized;
  }
  throw new ValidationError(
    'outcome_action_applied must be omitted for ordinary continuation; use it only for reopen_subject, route_to_role, block_subject, escalate, or terminate_branch',
  );
}

function normalizeHandoffStates(input: SubmitTaskHandoffInput) {
  const completion = normalizeCompletionState(input.completion);
  const completionState = normalizeCompletionState(input.completion_state);
  const resolution = normalizeHandoffResolution(input.resolution ?? input.role_data?.resolution);
  const decisionState = normalizeHandoffResolution(input.decision_state ?? input.role_data?.decision_state);

  if (completion && completionState && completion !== completionState) {
    throw new ValidationError(
      'completion/completion_state and resolution/decision_state must agree when both are provided',
    );
  }
  if (resolution && decisionState && resolution !== decisionState) {
    throw new ValidationError(
      'completion/completion_state and resolution/decision_state must agree when both are provided',
    );
  }

  const normalizedCompletion = completionState ?? completion;
  if (!normalizedCompletion) {
    throw new ValidationError('completion or completion_state is required');
  }

  return {
    completion_state: normalizedCompletion,
    decision_state: decisionState ?? resolution,
  };
}

export function resolveSubjectRef(
  input: SubmitTaskHandoffInput,
  roleData: Record<string, unknown>,
  branchId: string | null,
) {
  const explicit = sanitizeNullableSubjectRef(input.subject_ref);
  const derived = deriveSubjectRef(roleData, branchId);
  if (explicit && derived && !areJsonValuesEquivalent(explicit, derived)) {
    throw new ValidationError('subject_ref must match the task-linked subject metadata');
  }
  return explicit ?? derived;
}

export function deriveSubjectRef(roleData: Record<string, unknown>, branchId: string | null) {
  if (branchId) {
    return compactRecord({
      kind: 'branch',
      branch_id: branchId,
      task_id: readOptionalString(roleData.subject_task_id),
      work_item_id: readOptionalString(roleData.subject_work_item_id),
      handoff_id: readOptionalString(roleData.subject_handoff_id),
    });
  }

  const taskId = readOptionalString(roleData.subject_task_id);
  const workItemId = readOptionalString(roleData.subject_work_item_id);
  const handoffId = readOptionalString(roleData.subject_handoff_id);
  if (taskId) {
    return compactRecord({
      kind: 'task',
      task_id: taskId,
      work_item_id: workItemId,
      handoff_id: handoffId,
    });
  }
  if (workItemId) {
    return compactRecord({
      kind: 'work_item',
      work_item_id: workItemId,
      handoff_id: handoffId,
    });
  }
  if (handoffId) {
    return { kind: 'handoff', handoff_id: handoffId };
  }
  return null;
}

export function sanitizeNullableSubjectRef(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return sanitizeHandoffRecord(value);
}

export function normalizeUUIDString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function resolveSubjectRevision(
  input: SubmitTaskHandoffInput,
  roleData: Record<string, unknown>,
) {
  const explicit = readOptionalPositiveInteger(input.subject_revision);
  const derived = readOptionalPositiveInteger(roleData.subject_revision);
  if (explicit !== null && derived !== null && explicit !== derived) {
    throw new ValidationError('subject_revision must match the task-linked subject metadata');
  }
  return explicit ?? derived;
}

function allowsHandoffResolution(task: TaskContextRow) {
  const taskKind = readWorkflowTaskKind(task.metadata, task.is_orchestrator_task);
  return taskKind === 'assessment' || taskKind === 'approval';
}

function readActivationEventAnchor(input: Record<string, unknown> | null | undefined) {
  const events = Array.isArray(input?.events) ? input.events : [];
  for (const entry of events) {
    const event = normalizeRecord(entry);
    const payload = normalizeRecord(event.payload);
    const workItemId = readOptionalString(event.work_item_id) ?? readOptionalString(payload.work_item_id);
    const stageName = readOptionalString(event.stage_name) ?? readOptionalString(payload.stage_name);
    if (!workItemId && !stageName) {
      continue;
    }
    return {
      work_item_id: workItemId ?? null,
      stage_name: stageName ?? null,
    };
  }
  return {
    work_item_id: null,
    stage_name: null,
  };
}

function buildSystemOwnedRoleData(
  task: TaskContextRow,
  input: SubmitTaskHandoffInput,
  branchId: string | null,
) {
  const taskKind = readWorkflowTaskKind(task.metadata, task.is_orchestrator_task);
  const roleData = sanitizeHandoffRecord(input.role_data);
  const closureEffect = normalizeClosureEffect(input.closure_effect ?? roleData.closure_effect);

  if (taskKind === 'delivery') {
    const persistedRevision = readInteger(normalizeRecord(task.metadata).output_revision) ?? 0;
    const reworkDerivedRevision = (readInteger(task.rework_count) ?? 0) + 1;
    const inputRevision =
      readOptionalPositiveInteger(input.subject_revision)
      ?? readOptionalPositiveInteger(task.input?.subject_revision);
    const subjectRevision = Math.max(persistedRevision, reworkDerivedRevision, inputRevision ?? 0);
    const normalized = sanitizeHandoffRecord({
      ...roleData,
      task_kind: taskKind,
      ...(closureEffect ? { closure_effect: closureEffect } : {}),
      subject_task_id: task.id,
      ...(task.work_item_id ? { subject_work_item_id: task.work_item_id } : {}),
      ...(subjectRevision > 0 ? { subject_revision: subjectRevision } : {}),
      ...(branchId ? { branch_id: branchId } : {}),
    });
    return normalized;
  }

  const linkage = readAssessmentSubjectLinkage(task.input, task.metadata);
  const normalized = sanitizeHandoffRecord({
    ...roleData,
    task_kind: taskKind,
    ...(closureEffect ? { closure_effect: closureEffect } : {}),
    ...(linkage.subjectTaskId ? { subject_task_id: linkage.subjectTaskId } : {}),
    ...(linkage.subjectWorkItemId ? { subject_work_item_id: linkage.subjectWorkItemId } : {}),
    ...(linkage.subjectHandoffId ? { subject_handoff_id: linkage.subjectHandoffId } : {}),
    ...(linkage.subjectRevision !== null ? { subject_revision: linkage.subjectRevision } : {}),
    ...(branchId ? { branch_id: branchId } : {}),
  });
  return normalized;
}
