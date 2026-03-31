export const ACTIVE_TASK_DUPLICATE_GUARD_STATES = [
  'pending',
  'ready',
  'claimed',
  'in_progress',
  'awaiting_approval',
  'output_pending_assessment',
  'escalated',
] as const;

export const REUSABLE_TASK_DUPLICATE_GUARD_STATES = [
  ...ACTIVE_TASK_DUPLICATE_GUARD_STATES,
  'completed',
] as const;
