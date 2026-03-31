import { ConflictError } from '../../errors/domain-errors.js';
import { buildReplayConflictOperatorGuidance, type ReplayConflictOperatorField } from '../guided-closure/recovery-helpers.js';
import { areJsonValuesEquivalent } from '../json-equivalence.js';
import { logSafetynetTriggered } from '../safetynet/logging.js';
import {
  PLATFORM_HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_ID,
  mustGetSafetynetEntry,
} from '../safetynet/registry.js';
import { completionCalloutsSchema } from '../guided-closure/types.js';
import type { TaskContextRow, TaskHandoffRow } from './handoff-service.types.js';
import {
  deriveSubjectRef,
  normalizeCompletionState,
  normalizeHandoffResolution,
  sanitizeNullableSubjectRef,
} from './handoff-service.domain.js';
import {
  compactRecord,
  isEditableTaskState,
  normalizeRecord,
  normalizeUUIDString,
  readOptionalPositiveInteger,
  readOptionalString,
} from './handoff-service.response.js';

const HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_ID,
);

function normalizeCompletionCalloutsValue(value: unknown) {
  return completionCalloutsSchema.parse(value ?? {});
}

export function canReusePersistedTaskAttemptHandoff(
  task: TaskContextRow,
  existing: TaskHandoffRow,
  expected: {
    task_rework_count: number;
  },
) {
  return (
    !isEditableTaskState(task.state)
    && existing.task_id === task.id
    && existing.task_rework_count === expected.task_rework_count
  );
}

export function canReuseCurrentTaskAttemptAfterEarlierAttemptReplay(
  task: TaskContextRow,
  replayMatch: TaskHandoffRow,
  currentAttemptHandoff: TaskHandoffRow,
  expected: {
    task_rework_count: number;
  },
) {
  return (
    replayMatch.task_id === task.id
    && replayMatch.task_rework_count !== expected.task_rework_count
    && currentAttemptHandoff.task_id === task.id
    && currentAttemptHandoff.task_rework_count === expected.task_rework_count
  );
}

export function logCurrentAttemptReplayRepair(
  task: TaskContextRow,
  currentAttemptHandoff: TaskHandoffRow,
  replayMatch: TaskHandoffRow,
  expected: {
    request_id: string | null;
    task_rework_count: number;
  },
) {
  if (!canReuseCurrentTaskAttemptAfterEarlierAttemptReplay(task, replayMatch, currentAttemptHandoff, expected)) {
    return;
  }
  logSafetynetTriggered(
    HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_SAFETYNET,
    'stale earlier-attempt request_id replay reused the persisted current task-attempt handoff',
    {
      task_id: task.id,
      workflow_id: task.workflow_id,
      stale_request_id: expected.request_id,
      stale_task_rework_count: replayMatch.task_rework_count,
      current_task_rework_count: currentAttemptHandoff.task_rework_count,
      current_handoff_id: currentAttemptHandoff.id,
    },
  );
}

export function buildReplayConflictError(
  task: TaskContextRow | null,
  existing: TaskHandoffRow,
  expected: {
    request_id: string | null;
    task_rework_count: number;
    summary: string;
    completion_state: 'full' | 'blocked';
    decision_state: 'approved' | 'request_changes' | 'rejected' | 'blocked' | null;
    changes: unknown[];
    focus_areas: string[];
    artifact_ids: string[];
    successor_context: string | null;
    role: string;
    team_name: string | null;
    stage_name: string | null;
    remaining_items: unknown[];
    blockers: unknown[];
    known_risks: string[];
    recommended_next_actions: unknown[];
    waived_steps: unknown[];
    completion_callouts: Record<string, unknown>;
    role_data: Record<string, unknown>;
    subject_ref: Record<string, unknown> | null;
    subject_revision: number | null;
    outcome_action_applied: string | null;
    branch_id: string | null;
    completion: 'full' | 'blocked';
  },
  currentAttemptHandoff: TaskHandoffRow | null = null,
) {
  const replayConflictFields = describeReplayConflictFields(existing, expected);
  const operatorGuidance = buildReplayConflictOperatorGuidance({
    submitted_request_id: expected.request_id,
    submitted_task_rework_count: expected.task_rework_count,
    persisted_handoff: {
      id: existing.id,
      request_id: existing.request_id,
      task_id: existing.task_id,
      task_rework_count: existing.task_rework_count,
      created_at: existing.created_at.toISOString(),
      summary: existing.summary,
      completion_state: normalizeCompletionState(existing.completion_state ?? existing.completion),
      decision_state: normalizeHandoffResolution(existing.decision_state ?? existing.resolution),
    },
    current_attempt_handoff:
      currentAttemptHandoff
        ? {
            id: currentAttemptHandoff.id,
            request_id: currentAttemptHandoff.request_id,
            task_id: currentAttemptHandoff.task_id,
            task_rework_count: currentAttemptHandoff.task_rework_count,
            created_at: currentAttemptHandoff.created_at.toISOString(),
            summary: currentAttemptHandoff.summary,
            completion_state: normalizeCompletionState(
              currentAttemptHandoff.completion_state ?? currentAttemptHandoff.completion,
            ),
            decision_state: normalizeHandoffResolution(
              currentAttemptHandoff.decision_state ?? currentAttemptHandoff.resolution,
            ),
          }
        : null,
    replay_conflict_fields: replayConflictFields,
  });
  return new ConflictError(
    'submit_handoff replay conflicted with the persisted handoff for this task attempt',
    {
      reason_code: 'submit_handoff_replay_conflict',
      recovery_hint: 'inspect_persisted_handoff_or_use_new_request_id',
      recoverable: true,
      task_state: task?.state ?? null,
      task_id: task?.id ?? existing.task_id,
      workflow_id: task?.workflow_id ?? existing.workflow_id,
      work_item_id: task?.work_item_id ?? existing.work_item_id,
      task_rework_count: expected.task_rework_count,
      existing_handoff: {
        id: existing.id,
        request_id: existing.request_id,
        task_id: existing.task_id,
        task_rework_count: existing.task_rework_count,
        created_at: existing.created_at.toISOString(),
        completion_state: normalizeCompletionState(existing.completion_state ?? existing.completion),
        decision_state: normalizeHandoffResolution(existing.decision_state ?? existing.resolution),
      },
      conflict_source: operatorGuidance.conflict_source,
      task_contract_satisfied_by_persisted_handoff:
        operatorGuidance.task_contract_satisfied_by_persisted_handoff,
      conflicting_request_ids: operatorGuidance.conflicting_request_ids,
      replay_conflict_fields: replayConflictFields,
      recovery: {
        status: 'action_required',
        reason: 'submit_handoff_replay_conflict',
        action: 'inspect_persisted_handoff_or_use_new_request_id',
      },
      escalation_guidance: {
        reason: 'submit_handoff replay conflict',
        context_summary: operatorGuidance.context_summary,
        work_so_far: operatorGuidance.work_so_far,
      },
      suggested_next_actions: [
        {
          action_code: 'inspect_persisted_handoff',
          target_type: 'handoff',
          target_id: existing.id,
          why: 'Compare the replayed payload to the persisted handoff before retrying the mutation.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'resubmit_handoff_with_new_request_id',
          target_type: 'task',
          target_id: task?.id ?? existing.task_id,
          why: 'Reuse the same request_id only for an intentional retry of the exact same handoff payload.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'resolve_or_escalate_handoff_conflict',
          target_type: 'task',
          target_id: task?.id ?? existing.task_id,
          why: 'If the persisted handoff is authoritative, settle from it. If it is wrong and the task is no longer editable, escalate for operator resolution.',
          requires_orchestrator_judgment: true,
        },
      ],
    },
  );
}

export function describeReplayConflictFields(
  existing: TaskHandoffRow,
  expected: {
    summary: string;
    completion_state: 'full' | 'blocked';
    decision_state: 'approved' | 'request_changes' | 'rejected' | 'blocked' | null;
    successor_context: string | null;
    changes: unknown[];
    focus_areas: string[];
    artifact_ids: string[];
  },
): ReplayConflictOperatorField[] {
  const fields: ReplayConflictOperatorField[] = [];
  appendReplayConflictField(fields, 'summary', existing.summary, expected.summary);
  appendReplayConflictField(
    fields,
    'completion_state',
    normalizeCompletionState(existing.completion_state ?? existing.completion),
    expected.completion_state,
  );
  appendReplayConflictField(
    fields,
    'decision_state',
    normalizeHandoffResolution(existing.decision_state ?? existing.resolution),
    expected.decision_state,
  );
  appendReplayConflictField(fields, 'successor_context', existing.successor_context ?? null, expected.successor_context);
  appendReplayConflictField(fields, 'changes', existing.changes, expected.changes);
  appendReplayConflictField(fields, 'focus_areas', existing.focus_areas, expected.focus_areas);
  appendReplayConflictField(fields, 'artifact_ids', existing.artifact_ids, expected.artifact_ids);
  return fields;
}

export function matchesHandoffReplay(
  existing: TaskHandoffRow,
  expected: {
    role: string;
    team_name: string | null;
    stage_name: string | null;
    summary: string;
    completion_state: 'full' | 'blocked';
    decision_state: 'approved' | 'request_changes' | 'rejected' | 'blocked' | null;
    changes: unknown[];
    decisions: unknown[];
    remaining_items: unknown[];
    blockers: unknown[];
    focus_areas: string[];
    known_risks: string[];
    recommended_next_actions: unknown[];
    waived_steps: unknown[];
    completion_callouts: Record<string, unknown>;
    successor_context: string | null;
    role_data: Record<string, unknown>;
    subject_ref: Record<string, unknown> | null;
    subject_revision: number | null;
    outcome_action_applied: string | null;
    branch_id: string | null;
    artifact_ids: string[];
  },
) {
  const existingRoleData = normalizeRecord(existing.role_data);
  const existingBranchId =
    normalizeUUIDString(existing.branch_id)
    ?? normalizeUUIDString(existingRoleData.branch_id);
  const existingSubjectRef =
    sanitizeNullableSubjectRef(existing.subject_ref)
    ?? deriveSubjectRef(existingRoleData, existingBranchId);
  const existingSubjectRevision =
    readOptionalPositiveInteger(existing.subject_revision)
    ?? readOptionalPositiveInteger(existingRoleData.subject_revision);

  return !(
    existing.role !== expected.role ||
    (existing.team_name ?? null) !== expected.team_name ||
    (existing.stage_name ?? null) !== expected.stage_name ||
    existing.summary !== expected.summary ||
    normalizeCompletionState(existing.completion_state ?? existing.completion) !== expected.completion_state ||
    normalizeHandoffResolution(existing.decision_state ?? existing.resolution) !== expected.decision_state ||
    !areJsonValuesEquivalent(existing.changes, expected.changes) ||
    !areJsonValuesEquivalent(existing.decisions, expected.decisions) ||
    !areJsonValuesEquivalent(existing.remaining_items, expected.remaining_items) ||
    !areJsonValuesEquivalent(existing.blockers, expected.blockers) ||
    !areJsonValuesEquivalent(existing.focus_areas, expected.focus_areas) ||
    !areJsonValuesEquivalent(existing.known_risks, expected.known_risks) ||
    !areJsonValuesEquivalent(existing.recommended_next_actions ?? [], expected.recommended_next_actions) ||
    !areJsonValuesEquivalent(existing.waived_steps ?? [], expected.waived_steps) ||
    !areJsonValuesEquivalent(
      normalizeCompletionCalloutsValue(existing.completion_callouts),
      expected.completion_callouts,
    ) ||
    (existing.successor_context ?? null) !== expected.successor_context ||
    !areJsonValuesEquivalent(existing.role_data, expected.role_data) ||
    !areJsonValuesEquivalent(existingSubjectRef, expected.subject_ref ?? null) ||
    existingSubjectRevision !== expected.subject_revision ||
    (existing.outcome_action_applied ?? null) !== expected.outcome_action_applied ||
    existingBranchId !== expected.branch_id ||
    !areJsonValuesEquivalent(existing.artifact_ids, expected.artifact_ids)
  );
}

function appendReplayConflictField(
  fields: ReplayConflictOperatorField[],
  field: string,
  persistedValue: unknown,
  submittedValue: unknown,
) {
  if (areJsonValuesEquivalent(persistedValue, submittedValue)) {
    return;
  }
  fields.push({
    field,
    persisted_value: formatReplayConflictValue(persistedValue),
    submitted_value: formatReplayConflictValue(submittedValue),
    operator_message:
      `Persisted handoff ${field.replace(/_/g, ' ')} is ${quoteReplayConflictValue(persistedValue)}, `
      + `but the replayed handoff ${field.replace(/_/g, ' ')} is ${quoteReplayConflictValue(submittedValue)}.`,
  });
}

function formatReplayConflictValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  const serialized = JSON.stringify(value);
  return serialized.length > 240 ? `${serialized.slice(0, 237)}...` : serialized;
}

function quoteReplayConflictValue(value: unknown) {
  const formatted = formatReplayConflictValue(value);
  return formatted === null ? '"(none)"' : `"${formatted}"`;
}
