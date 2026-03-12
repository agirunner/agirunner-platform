const CANONICAL_TASK_STATES = new Set([
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
  'blocked',
]);

export function normalizeTaskState(value: string | null | undefined): string {
  const normalized = (value ?? '').toLowerCase();
  if (!normalized) {
    return '';
  }
  return CANONICAL_TASK_STATES.has(normalized) ? normalized : normalized;
}
