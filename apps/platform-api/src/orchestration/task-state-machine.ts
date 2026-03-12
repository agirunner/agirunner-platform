import { InvalidStateTransitionError } from '../errors/domain-errors.js';

export const taskStates = [
  'pending',
  'ready',
  'claimed',
  'in_progress',
  'awaiting_approval',
  'output_pending_review',
  'escalated',
  'completed',
  'failed',
  'cancelled',
] as const;

export type CanonicalTaskState = (typeof taskStates)[number];
export type LegacyTaskStateAlias = 'running' | 'awaiting_escalation';
export type TaskState = CanonicalTaskState | LegacyTaskStateAlias;

const legacyTaskStateAliases: Record<LegacyTaskStateAlias, CanonicalTaskState> = {
  running: 'in_progress',
  awaiting_escalation: 'escalated',
};

const transitionTable: Record<CanonicalTaskState, ReadonlySet<CanonicalTaskState>> = {
  pending: new Set(['ready', 'awaiting_approval', 'cancelled']),
  ready: new Set(['claimed', 'cancelled']),
  claimed: new Set(['in_progress', 'cancelled']),
  in_progress: new Set(['completed', 'failed', 'output_pending_review', 'escalated', 'cancelled']),
  awaiting_approval: new Set(['ready', 'cancelled']),
  output_pending_review: new Set(['completed', 'failed', 'ready', 'cancelled']),
  escalated: new Set(['ready', 'cancelled', 'failed']),
  completed: new Set(),
  failed: new Set(['ready', 'escalated', 'cancelled']),
  cancelled: new Set(),
};

export function canTransitionState(current: TaskState, requested: TaskState): boolean {
  const normalizedCurrent = normalizeTaskState(current);
  const normalizedRequested = normalizeTaskState(requested);
  if (!normalizedCurrent || !normalizedRequested) {
    return false;
  }
  return transitionTable[normalizedCurrent].has(normalizedRequested);
}

export function assertValidTransition(taskId: string, current: TaskState, requested: TaskState): void {
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
  if (state in legacyTaskStateAliases) {
    return legacyTaskStateAliases[state as LegacyTaskStateAlias];
  }
  return taskStates.includes(state as CanonicalTaskState) ? (state as CanonicalTaskState) : null;
}

export function toStoredTaskState(state: TaskState): string {
  return state === 'in_progress' ? 'running' : state === 'escalated' ? 'awaiting_escalation' : state;
}
