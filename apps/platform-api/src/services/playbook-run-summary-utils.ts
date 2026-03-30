import { sanitizeSecretLikeValue } from './secret-redaction.js';
import type { TimelineEventRow, WorkflowActivationSummaryRow } from './playbook-run-summary.types.js';

export const CHILD_WORKFLOW_EVENT_TYPES = new Set([
  'child_workflow.completed',
  'child_workflow.failed',
  'child_workflow.cancelled',
]);

const WORKFLOW_SUMMARY_SECRET_REDACTION = 'redacted://workflow-summary-secret';

export function countEvents(events: TimelineEventRow[], type: string) {
  return events.filter((event) => event.type === type).length;
}

export function isGateEvent(type: string) {
  return [
    'stage.gate_requested',
    'stage.gate.approve',
    'stage.gate.reject',
    'stage.gate.request_changes',
  ].includes(type);
}

export function appendUnique(values: string[], next: string | undefined) {
  if (!next || values.includes(next)) {
    return values;
  }
  return [...values, next];
}

export function calculateDurationSeconds(startedAt: unknown, completedAt: unknown) {
  const start = asDate(startedAt);
  const end = asDate(completedAt);
  if (!start || !end) {
    return null;
  }
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

export function minimumDate(values: Array<Date | null>) {
  return values.filter((value): value is Date => value instanceof Date).sort(compareDateAsc)[0] ?? null;
}

export function latestDate(values: Array<Date | null>) {
  const filtered = values.filter((value): value is Date => value instanceof Date).sort(compareDateAsc);
  return filtered[filtered.length - 1] ?? null;
}

export function asDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function readTaskCostUsd(task: Record<string, unknown>) {
  return roundCurrency(Number(asRecord(task.metrics).total_cost_usd ?? 0));
}

export function roundCurrency(value: number) {
  return Number(value.toFixed(6));
}

export function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readWorkflowLifecycle(workflow: Record<string, unknown>) {
  return workflow.lifecycle === 'ongoing' ? 'ongoing' : 'planned';
}

export function readWorkflowRelations(
  workflow: Record<string, unknown>,
  metadata: Record<string, unknown>,
) {
  const existing = asRecord(workflow.workflow_relations);
  if (Object.keys(existing).length > 0) {
    return existing;
  }
  const parentWorkflowId = asOptionalString(metadata.parent_workflow_id);
  const childWorkflowIds = readStringArray(metadata.child_workflow_ids);
  const latestChildWorkflowId = asOptionalString(metadata.latest_child_workflow_id);
  return {
    parent: parentWorkflowId
      ? {
          workflow_id: parentWorkflowId,
          name: null,
          state: 'unknown',
          playbook_id: null,
          playbook_name: null,
          created_at: null,
          started_at: null,
          completed_at: null,
          is_terminal: false,
          link: `/workflows/${parentWorkflowId}`,
        }
      : null,
    children: childWorkflowIds.map((workflowId) => ({
      workflow_id: workflowId,
      name: null,
      state: 'unknown',
      playbook_id: null,
      playbook_name: null,
      created_at: null,
      started_at: null,
      completed_at: null,
      is_terminal: false,
      link: `/workflows/${workflowId}`,
    })),
    latest_child_workflow_id: latestChildWorkflowId ?? null,
    child_status_counts: {
      total: childWorkflowIds.length,
      active: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    },
  };
}

export function sanitizeWorkflowSummary<T>(value: T): T {
  return sanitizeSecretLikeValue(value, {
    redactionValue: WORKFLOW_SUMMARY_SECRET_REDACTION,
    allowSecretReferences: false,
  }) as T;
}

export function deriveActivationStatus(currentStatus: string, eventType: string) {
  if (eventType === 'workflow.activation_failed') return 'failed';
  if (eventType === 'workflow.activation_completed') return 'completed';
  if (eventType === 'workflow.activation_requeued') return 'requeued';
  if (eventType === 'workflow.activation_stale_detected') return 'stale_detected';
  if (eventType === 'workflow.activation_started') return 'in_progress';
  if (eventType === 'workflow.activation_queued') {
    return currentStatus === 'requeued' ? 'requeued' : 'queued';
  }
  return currentStatus;
}

export function deriveActivationStatusFromRow(row: WorkflowActivationSummaryRow) {
  const recoveryStatus = readActivationRecoveryStatus(row.error);
  if (recoveryStatus === 'stale_detected') return 'stale_detected';
  if (recoveryStatus === 'requeued') return 'requeued';
  if (row.state === 'failed') return 'failed';
  if (row.state === 'completed') return 'completed';
  if (row.started_at || row.state === 'processing') return 'in_progress';
  return 'queued';
}

export function readActivationRecoveryStatus(error: Record<string, unknown> | null) {
  return asOptionalString(asRecord(asRecord(error).recovery).status);
}

export function latestActivationTimestamp(row: WorkflowActivationSummaryRow) {
  return (
    row.completed_at?.toISOString() ??
    row.consumed_at?.toISOString() ??
    row.started_at?.toISOString() ??
    row.queued_at.toISOString()
  );
}

export function maxIsoTimestamp(left: string, right: string) {
  return left.localeCompare(right) >= 0 ? left : right;
}

function compareDateAsc(left: Date, right: Date) {
  return left.getTime() - right.getTime();
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}
