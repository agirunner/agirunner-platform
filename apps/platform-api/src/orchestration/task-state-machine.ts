import { InvalidStateTransitionError } from '../errors/domain-errors.js';

export const taskStates = [
  'pending',
  'ready',
  'claimed',
  'in_progress',
  'awaiting_approval',
  'output_pending_assessment',
  'escalated',
  'completed',
  'failed',
  'cancelled',
] as const;

export type CanonicalTaskState = (typeof taskStates)[number];
export type TaskState = CanonicalTaskState;

const transitionTable: Record<CanonicalTaskState, ReadonlySet<CanonicalTaskState>> = {
  pending: new Set(['ready', 'awaiting_approval', 'cancelled']),
  ready: new Set(['claimed', 'cancelled']),
  claimed: new Set(['in_progress', 'cancelled']),
  in_progress: new Set(['completed', 'failed', 'output_pending_assessment', 'escalated', 'cancelled']),
  awaiting_approval: new Set(['ready', 'cancelled']),
  output_pending_assessment: new Set(['completed', 'failed', 'ready', 'cancelled']),
  escalated: new Set(['ready', 'cancelled', 'failed']),
  completed: new Set(['failed']),
  failed: new Set(['ready', 'escalated', 'cancelled']),
  cancelled: new Set(),
};

export function canTransitionState(current: string, requested: string): boolean {
  const normalizedCurrent = normalizeTaskState(current);
  const normalizedRequested = normalizeTaskState(requested);
  if (!normalizedCurrent || !normalizedRequested) {
    return false;
  }
  return transitionTable[normalizedCurrent].has(normalizedRequested);
}

export function assertValidTransition(taskId: string, current: string, requested: string): void {
  if (canTransitionState(current, requested)) {
    return;
  }

  throw new InvalidStateTransitionError(`Cannot transition from '${current}' to '${requested}'`, {
    current_state: current,
    requested_state: requested,
    task_id: taskId,
  });
}

export function normalizeTaskState(state: string | null | undefined): CanonicalTaskState | null {
  if (!state) {
    return null;
  }
  return taskStates.includes(state as CanonicalTaskState) ? (state as CanonicalTaskState) : null;
}

export function toStoredTaskState(state: string): CanonicalTaskState {
  const normalized = normalizeTaskState(state);
  if (!normalized) {
    throw new InvalidStateTransitionError(`Unknown task state '${state}'`, {
      current_state: state,
      requested_state: state,
    });
  }
  return normalized;
}
