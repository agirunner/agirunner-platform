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

const LEGACY_TASK_STATE_ALIASES: Record<string, string> = {
  running: 'in_progress',
  awaiting_escalation: 'escalated',
};

export function normalizeTaskState(value: string | null | undefined): string {
  const normalized = (value ?? '').toLowerCase();
  if (!normalized) {
    return '';
  }
  if (CANONICAL_TASK_STATES.has(normalized)) {
    return normalized;
  }
  return LEGACY_TASK_STATE_ALIASES[normalized] ?? normalized;
}
