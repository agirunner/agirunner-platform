export const TASK_STATES = [
  'pending',
  'ready',
  'claimed',
  'running',
  'output_pending_review',
  'awaiting_approval',
  'failed',
  'completed',
  'cancelled',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export interface TaskStateChangedEvent {
  type: 'task.state_changed';
  task_id: string;
  previous_state: TaskState;
  state: TaskState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTaskState(value: unknown): value is TaskState {
  return typeof value === 'string' && TASK_STATES.includes(value as TaskState);
}

export function isTaskStateChangedEvent(value: unknown): value is TaskStateChangedEvent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.type === 'task.state_changed' &&
    typeof value.task_id === 'string' &&
    isTaskState(value.previous_state) &&
    isTaskState(value.state)
  );
}
