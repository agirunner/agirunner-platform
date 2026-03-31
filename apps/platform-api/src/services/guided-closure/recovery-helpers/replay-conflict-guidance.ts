export interface ReplayConflictOperatorField {
  field: string;
  persisted_value: string | null;
  submitted_value: string | null;
  operator_message: string;
}

interface ReplayConflictOperatorHandoffSummary {
  id: string;
  request_id: string | null;
  task_id: string;
  task_rework_count: number;
  created_at: string;
  summary: string;
  completion_state: string | null;
  decision_state: string | null;
}

interface BuildReplayConflictOperatorGuidanceInput {
  submitted_request_id: string | null;
  submitted_task_rework_count: number;
  persisted_handoff: ReplayConflictOperatorHandoffSummary;
  current_attempt_handoff?: ReplayConflictOperatorHandoffSummary | null;
  replay_conflict_fields: ReplayConflictOperatorField[];
}

export function buildReplayConflictOperatorGuidance(
  input: BuildReplayConflictOperatorGuidanceInput,
) {
  const conflictSource = resolveReplayConflictSource(input);
  const taskContractSatisfied =
    input.current_attempt_handoff?.task_rework_count === input.submitted_task_rework_count
    && input.current_attempt_handoff.id !== input.persisted_handoff.id;

  return {
    conflict_source: conflictSource,
    task_contract_satisfied_by_persisted_handoff: taskContractSatisfied,
    conflicting_request_ids: {
      submitted_request_id: input.submitted_request_id,
      persisted_request_id: input.persisted_handoff.request_id,
      current_attempt_request_id: input.current_attempt_handoff?.request_id ?? null,
    },
    context_summary: buildReplayConflictContextSummary(input, conflictSource),
    work_so_far: buildReplayConflictWorkSoFar(input, conflictSource, taskContractSatisfied),
  };
}

function resolveReplayConflictSource(
  input: BuildReplayConflictOperatorGuidanceInput,
): 'stale_request_id_from_prior_attempt' | 'same_request_id_different_payload' | 'different_request_id_after_persisted_handoff' {
  if (input.persisted_handoff.task_rework_count !== input.submitted_task_rework_count) {
    return 'stale_request_id_from_prior_attempt';
  }
  if (
    input.submitted_request_id
    && input.persisted_handoff.request_id
    && input.submitted_request_id === input.persisted_handoff.request_id
  ) {
    return 'same_request_id_different_payload';
  }
  return 'different_request_id_after_persisted_handoff';
}

function buildReplayConflictContextSummary(
  input: BuildReplayConflictOperatorGuidanceInput,
  conflictSource: ReturnType<typeof resolveReplayConflictSource>,
) {
  if (conflictSource === 'stale_request_id_from_prior_attempt') {
    return `submit_handoff request_id ${quoteOperatorValue(input.submitted_request_id)} is stale for rework ${input.submitted_task_rework_count}. It already belongs to persisted handoff ${quoteOperatorValue(input.persisted_handoff.id)} from rework ${input.persisted_handoff.task_rework_count}.`;
  }
  if (conflictSource === 'same_request_id_different_payload') {
    return `submit_handoff request_id ${quoteOperatorValue(input.submitted_request_id)} already belongs to persisted handoff ${quoteOperatorValue(input.persisted_handoff.id)} on this task attempt, but the replayed handoff body does not match the stored handoff.`;
  }
  return `This task attempt already has persisted handoff ${quoteOperatorValue(input.persisted_handoff.id)} with request_id ${quoteOperatorValue(input.persisted_handoff.request_id)}. A different submit_handoff request tried to write a conflicting handoff after that persisted handoff was already recorded.`;
}

function buildReplayConflictWorkSoFar(
  input: BuildReplayConflictOperatorGuidanceInput,
  conflictSource: ReturnType<typeof resolveReplayConflictSource>,
  taskContractSatisfied: boolean,
) {
  if (taskContractSatisfied && input.current_attempt_handoff) {
    return `The current rework ${input.submitted_task_rework_count} attempt already has persisted handoff ${quoteOperatorValue(input.current_attempt_handoff.id)} with request_id ${quoteOperatorValue(input.current_attempt_handoff.request_id)}, so the task contract is already satisfied. Settle the task or escalation from that handoff instead of replaying the stale request_id.`;
  }
  const mismatchSummary = input.replay_conflict_fields
    .slice(0, 2)
    .map((entry) => entry.operator_message)
    .join(' ');
  if (mismatchSummary.length > 0) {
    return `${mismatchSummary} Inspect the persisted handoff before retrying. If a genuinely different handoff is still required, submit it with a new request_id while the task is editable.`;
  }
  if (conflictSource === 'stale_request_id_from_prior_attempt') {
    return `Inspect the persisted handoff from rework ${input.persisted_handoff.task_rework_count} first. If the current attempt still needs a new handoff, submit it with a fresh request_id instead of reusing the older attempt's request_id.`;
  }
  return `Persisted handoff summary: ${quoteOperatorValue(input.persisted_handoff.summary)}. Inspect the stored handoff before retrying. If a genuinely different handoff is still required, submit it with a new request_id while the task is editable.`;
}

function quoteOperatorValue(value: string | null) {
  return value ? `"${value}"` : '"(none)"';
}
