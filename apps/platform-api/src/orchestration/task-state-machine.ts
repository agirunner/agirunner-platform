import { InvalidStateTransitionError } from '../errors/domain-errors.js';

export const taskStates = [
  'pending',
  'ready',
  'claimed',
  'running',
  'awaiting_approval',
  'output_pending_review',
  'awaiting_escalation',
  'completed',
  'failed',
  'cancelled',
] as const;

export type TaskState = (typeof taskStates)[number];

const transitionTable: Record<TaskState, ReadonlySet<TaskState>> = {
  pending: new Set(['ready', 'awaiting_approval', 'cancelled']),
  ready: new Set(['claimed', 'cancelled']),
  claimed: new Set(['running', 'cancelled']),
  running: new Set(['completed', 'failed', 'output_pending_review', 'awaiting_escalation', 'cancelled']),
  awaiting_approval: new Set(['ready', 'cancelled']),
  output_pending_review: new Set(['completed', 'failed', 'ready', 'cancelled']),
  awaiting_escalation: new Set(['ready', 'cancelled', 'failed']),
  completed: new Set([]),
  failed: new Set(['ready', 'awaiting_escalation', 'cancelled']),
  cancelled: new Set([]),
};

export function canTransitionState(current: TaskState, requested: TaskState): boolean {
  return transitionTable[current].has(requested);
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
