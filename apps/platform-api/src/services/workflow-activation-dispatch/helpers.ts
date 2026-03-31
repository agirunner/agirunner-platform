import {
  ACTIVATION_TASK_REQUEST_ID_PATTERN,
  ACTIVE_ORCHESTRATOR_TASK_STATES,
  BLOCKED_ACTIVATION_RECOVERY_STATUS,
  IMMEDIATE_QUEUE_DISPATCH_EVENT_TYPES,
  UUID_PATTERN,
  type ActivationTaskStatus,
  type QueuedActivationRow,
} from './types.js';

export function buildImmediateDispatchCondition(alias: string): string {
  const prefix = alias.trim().length > 0 ? `${alias}.` : '';
  return IMMEDIATE_QUEUE_DISPATCH_EVENT_TYPES.map((eventType) => `${prefix}event_type = '${eventType}'`).join(
    '\n            OR ',
  );
}

export function buildDispatchEligibilityCondition(alias: string, delayPlaceholder: string): string {
  const prefix = alias.trim().length > 0 ? `${alias}.` : '';
  return [
    buildImmediateDispatchCondition(alias),
    `${prefix}event_type = 'heartbeat'`,
    `${prefix}queued_at <= now() - (${delayPlaceholder} * interval '1 millisecond')`,
  ].join('\n            OR ');
}

export function isImmediateDispatchEvent(eventType: string): boolean {
  return IMMEDIATE_QUEUE_DISPATCH_EVENT_TYPES.includes(
    eventType as (typeof IMMEDIATE_QUEUE_DISPATCH_EVENT_TYPES)[number],
  );
}

export function deriveActivationReason(
  activationBatch: QueuedActivationRow[],
): 'queued_events' | 'heartbeat' {
  return activationBatch.some((event) => event.event_type !== 'heartbeat') ? 'queued_events' : 'heartbeat';
}

export function countDispatchableEvents(activationBatch: QueuedActivationRow[]): number {
  return activationBatch.filter((event) => event.event_type !== 'heartbeat').length;
}

export function derivePrimaryActivationEvent(
  activation: QueuedActivationRow,
  activationBatch: QueuedActivationRow[],
): QueuedActivationRow {
  return activationBatch.find((event) => event.event_type !== 'heartbeat') ?? activation;
}

export function formatActivationEventDetails(event: QueuedActivationRow): string | null {
  return formatActivationEventDetailsFromFields(event.event_type, event.payload);
}

export function formatActivationEventDetailsFromFields(
  eventType: string,
  payload: Record<string, unknown>,
): string | null {
  const details = [
    asNullableString(payload.task_id) ? `task_id=${asNullableString(payload.task_id)}` : null,
    asNullableString(payload.task_role) ? `task_role=${asNullableString(payload.task_role)}` : null,
    asNullableString(payload.stage_name) ? `stage_name=${asNullableString(payload.stage_name)}` : null,
    asNullableString(payload.work_item_id) ? `work_item_id=${asNullableString(payload.work_item_id)}` : null,
  ].filter((value): value is string => Boolean(value));

  if (details.length === 0) {
    return null;
  }

  return `${eventType} (${details.join(', ')})`;
}

export function buildActivationTaskRequestId(activation: QueuedActivationRow): string {
  return `activation:${activation.id}:dispatch:${activation.dispatch_attempt}`;
}

export function buildActivationSummary(
  task: Record<string, unknown>,
  status: ActivationTaskStatus,
): string | null {
  if (status === 'failed') {
    const error = task.error as Record<string, unknown> | null;
    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    return message || 'Orchestrator activation failed';
  }

  if (status === 'escalated') {
    const metadata = asRecord(task.metadata);
    const escalationReason = asNullableString(metadata.escalation_reason);
    if (escalationReason) {
      return escalationReason;
    }
  }

  const output = task.output as Record<string, unknown> | null;
  const summary = typeof output?.summary === 'string' ? output.summary.trim() : '';
  if (summary) {
    return summary;
  }

  const resultSummary = typeof task.title === 'string' ? String(task.title).trim() : '';
  return resultSummary || null;
}

export function normalizeFailedActivationError(value: unknown): Record<string, unknown> {
  const error = asRecord(value);
  return Object.keys(error).length > 0
    ? error
    : { message: 'Orchestrator activation failed' };
}

export function isBlockedFailedActivation(error: Record<string, unknown> | null): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const recovery = asRecord(error.recovery);
  if (Object.keys(recovery).length === 0) {
    return false;
  }
  return recovery.status === BLOCKED_ACTIVATION_RECOVERY_STATUS;
}

export function findActivationAnchor(
  activationId: string,
  rows: QueuedActivationRow[],
): QueuedActivationRow {
  return rows.find((row) => row.id === activationId) ?? rows[0];
}

export function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readTaskDispatchAttempt(task: Record<string, unknown>): number | null {
  const metadata = task.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return readTaskDispatchAttemptFromRequestId(task);
  }
  const value = (metadata as Record<string, unknown>).activation_dispatch_attempt;
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  return readTaskDispatchAttemptFromRequestId(task);
}

export function readTaskDispatchToken(task: Record<string, unknown>): string | null {
  const metadata = task.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>).activation_dispatch_token;
  if (typeof value !== 'string') {
    return null;
  }
  const token = value.trim();
  return UUID_PATTERN.test(token) ? token : null;
}

export function readTaskDispatchAttemptFromRequestId(task: Record<string, unknown>): number | null {
  const requestId =
    typeof task.request_id === 'string' && task.request_id.trim().length > 0
      ? task.request_id.trim()
      : null;
  const activationId =
    typeof task.activation_id === 'string' && task.activation_id.trim().length > 0
      ? task.activation_id.trim()
      : null;
  if (!requestId || !activationId) {
    return null;
  }

  const match = ACTIVATION_TASK_REQUEST_ID_PATTERN.exec(requestId);
  if (!match || match[1] !== activationId) {
    return null;
  }

  const attempt = Number.parseInt(match[2], 10);
  return Number.isSafeInteger(attempt) && attempt >= 1 ? attempt : null;
}

export function isReadyForDispatch(
  activation: QueuedActivationRow,
  activationDelayMs: number,
): boolean {
  if (activation.event_type === 'heartbeat' || isImmediateDispatchEvent(activation.event_type)) {
    return true;
  }

  return Date.now() - activation.queued_at.getTime() >= activationDelayMs;
}

export function buildHeartbeatRequestId(workflowId: string, heartbeatIntervalMs: number): string {
  const bucket = Math.floor(Date.now() / heartbeatIntervalMs);
  return `heartbeat:${workflowId}:${bucket}`;
}

export function hasReportedStaleRecovery(
  error: Record<string, unknown> | null,
  activeTaskId: string,
): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const recovery = error.recovery;
  if (!recovery || typeof recovery !== 'object') {
    return false;
  }
  const recoveryRecord = recovery as Record<string, unknown>;
  const status = typeof recoveryRecord.status === 'string' ? recoveryRecord.status : null;
  const taskId = typeof recoveryRecord.task_id === 'string' ? recoveryRecord.task_id : null;
  return status === 'stale_detected' && taskId === activeTaskId;
}

export function isActiveOrchestratorTaskState(state: string | null): boolean {
  return state != null
    && ACTIVE_ORCHESTRATOR_TASK_STATES.includes(
      state as (typeof ACTIVE_ORCHESTRATOR_TASK_STATES)[number],
    );
}

export function isActiveActivationConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as { code?: string; constraint?: string };
  return record.code === '23505' && record.constraint === 'idx_workflow_activations_active';
}
