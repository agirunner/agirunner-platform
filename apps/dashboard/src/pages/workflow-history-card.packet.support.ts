import type { DashboardPacketFact } from './workflow-detail-support.js';

/**
 * Internal identifiers and structural keys that carry no operational
 * value for an operator reviewing the interaction timeline.
 * These are suppressed from the curated fact display.
 */
const SUPPRESSED_KEYS = new Set([
  'activation_id',
  'actor_id',
  'actor_type',
  'assigned_role',
  'child_workflow_id',
  'child_workflow_name',
  'column_id',
  'dimensions',
  'entity_id',
  'entity_type',
  'parent_work_item_id',
  'stage_id',
  'stage_name',
  'task_id',
  'task_title',
  'to_column_id',
  'work_item_id',
  'work_item_title',
  'workflow_id',
]);

/**
 * Human-readable labels for known payload keys.
 * Keys absent from this map fall back to generic humanization.
 */
const CURATED_LABELS: Record<string, string> = {
  column_label: 'Column',
  cost_limit_usd: 'Cost limit',
  cost_usd: 'Current cost',
  duration_limit_minutes: 'Duration limit',
  elapsed_minutes: 'Elapsed',
  error: 'Error detail',
  feedback: 'Feedback',
  from_column_label: 'Previous column',
  from_state: 'Previous state',
  goal: 'Goal',
  message: 'Detail',
  notes: 'Notes',
  outcome: 'Outcome',
  parent_work_item_title: 'Parent item',
  playbook_name: 'Playbook',
  priority: 'Priority',
  reason: 'Reason',
  recommendation: 'Recommendation',
  request_summary: 'Review summary',
  role: 'Specialist role',
  severity: 'Severity',
  state: 'State',
  summary: 'Summary',
  title: 'Title',
  to_column_label: 'Destination column',
  to_state: 'New state',
  tokens_limit: 'Token limit',
  tokens_used: 'Tokens used',
};

interface PromotedField {
  key: string;
  label: string;
}

/**
 * Per-event-type ordered list of supplementary fields to surface
 * above generic alphabetical extraction. These complement the
 * narrative headline/summary with structured operational detail.
 */
const PROMOTED_FIELDS: Record<string, PromotedField[]> = {
  'child_workflow.completed': [{ key: 'playbook_name', label: 'Playbook' }],
  'child_workflow.failed': [{ key: 'playbook_name', label: 'Playbook' }],
  'task.completed': [{ key: 'role', label: 'Specialist role' }],
  'task.created': [{ key: 'goal', label: 'Step goal' }],
  'task.escalated': [
    { key: 'role', label: 'Specialist role' },
    { key: 'severity', label: 'Severity' },
  ],
  'task.failed': [{ key: 'role', label: 'Specialist role' }],
  'work_item.created': [{ key: 'priority', label: 'Priority' }],
  'work_item.moved': [{ key: 'from_column_label', label: 'Previous column' }],
  'work_item.updated': [{ key: 'priority', label: 'Priority' }],
  'workflow.state_changed': [
    { key: 'from_state', label: 'Previous state' },
    { key: 'to_state', label: 'New state' },
  ],
};

/**
 * Extracts operator-readable facts from a timeline event payload,
 * suppressing internal IDs and applying curated labels. Promoted
 * fields for the event type appear first; remaining non-suppressed
 * scalar fields backfill up to the limit.
 */
export function curatePacketFacts(
  eventType: string,
  data: unknown,
  limit = 4,
): DashboardPacketFact[] {
  const record = asRecord(data);
  const facts: DashboardPacketFact[] = [];
  const consumed = new Set<string>();

  const promoted = PROMOTED_FIELDS[eventType];
  if (promoted) {
    for (const field of promoted) {
      if (facts.length >= limit) return facts;
      const value = record[field.key];
      if (isPresentableScalar(value)) {
        facts.push({ label: field.label, value: formatFactValue(value) });
        consumed.add(field.key);
      }
    }
  }

  const remaining = Object.keys(record)
    .filter(
      (key) =>
        !consumed.has(key) &&
        !SUPPRESSED_KEYS.has(key) &&
        isPresentableScalar(record[key]),
    )
    .sort((a, b) => a.localeCompare(b));

  for (const key of remaining) {
    if (facts.length >= limit) break;
    facts.push({
      label: CURATED_LABELS[key] ?? humanizeFieldKey(key),
      value: formatFactValue(record[key]),
    });
  }

  return facts;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isPresentableScalar(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return typeof value === 'number' || typeof value === 'boolean';
}

function formatFactValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 96 ? `${value.slice(0, 93)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function humanizeFieldKey(key: string): string {
  const spaced = key.replaceAll('_', ' ').replaceAll('.', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
