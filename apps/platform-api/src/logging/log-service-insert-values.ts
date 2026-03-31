import { sanitizeSecretLikeValue } from '../services/secret-redaction.js';
import { LOG_SECRET_REDACTION } from './log-service-constants.js';
import type { ExecutionLogEntry } from './log-service-types.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOG_SECRET_REDACTION_OPTIONS = {
  redactionValue: LOG_SECRET_REDACTION,
  allowSecretReferences: false,
} as const;

const REDACT_EXEMPT_KEYS = new Set([
  'system_prompt',
  'prompt_summary',
  'response_summary',
  'description',
]);

const NON_SECRET_TOKEN_METRIC_KEYS = new Set([
  'tokens_in',
  'tokens_out',
  'total_tokens',
  'input_tokens',
  'output_tokens',
  'tokens_input',
  'tokens_output',
  'total_tokens_input',
  'total_tokens_output',
  'max_output_tokens',
]);

export function buildInsertValues(
  entry: ExecutionLogEntry,
  workflowName: string | null,
  workspaceName: string | null,
  stageName: string | null,
): unknown[] {
  const payload = sanitizeLogValue(redactPayload(entry.payload) ?? {}) as Record<string, unknown>;
  const error = entry.error
    ? sanitizeLogValue(redactError(entry.error)) as { code?: string; message: string; stack?: string }
    : null;
  const resourceId = normalizeLogResourceId(entry.resourceId);
  const resourceName = normalizeLogResourceName(entry.resourceName, entry.resourceId, resourceId);

  return [
    entry.tenantId,
    entry.traceId,
    entry.spanId,
    entry.parentSpanId ?? null,
    entry.source,
    entry.category,
    entry.level,
    sanitizeRequiredLogText(entry.operation),
    entry.status,
    entry.durationMs ?? null,
    JSON.stringify(payload),
    error ? JSON.stringify(error) : null,
    entry.workspaceId ?? null,
    entry.workflowId ?? null,
    sanitizeOptionalLogText(workflowName),
    sanitizeOptionalLogText(workspaceName),
    entry.taskId ?? null,
    entry.workItemId ?? null,
    entry.activationId ?? null,
    sanitizeOptionalLogText(entry.taskTitle),
    sanitizeOptionalLogText(stageName),
    entry.isOrchestratorTask ?? false,
    entry.executionBackend ?? null,
    entry.toolOwner ?? null,
    sanitizeOptionalLogText(entry.role),
    sanitizeOptionalLogText(entry.actorType),
    sanitizeOptionalLogText(entry.actorId),
    sanitizeOptionalLogText(entry.actorName),
    sanitizeOptionalLogText(entry.resourceType),
    resourceId,
    resourceName,
    entry.createdAt ?? null,
  ];
}

function redactPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) return {};
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    redacted[key] = redactValue(key, value);
  }
  return redacted;
}

function redactError(error: { code?: string; message: string; stack?: string }) {
  return {
    ...(error.code ? { code: error.code } : {}),
    message: redactString('message', error.message),
    ...(error.stack ? { stack: redactString('stack', error.stack) } : {}),
  };
}

function redactValue(key: string, value: unknown): unknown {
  if (REDACT_EXEMPT_KEYS.has(key) || NON_SECRET_TOKEN_METRIC_KEYS.has(key)) {
    return value;
  }
  if (isSecretLikeLogKey(key)) {
    return LOG_SECRET_REDACTION;
  }
  return sanitizeLogSecretValue(key, value);
}

function redactString(key: string, value: string): string {
  if (REDACT_EXEMPT_KEYS.has(key) || NON_SECRET_TOKEN_METRIC_KEYS.has(key)) {
    return value;
  }
  const redacted = sanitizeLogSecretValue(key, value);
  return typeof redacted === 'string' ? redacted : LOG_SECRET_REDACTION;
}

function sanitizeLogSecretValue(key: string, value: unknown): unknown {
  const sanitized = sanitizeSecretLikeValue({ [key]: value }, LOG_SECRET_REDACTION_OPTIONS) as Record<
    string,
    unknown
  >;
  return sanitized[key];
}

function isSecretLikeLogKey(key: string): boolean {
  return sanitizeLogSecretValue(key, 'present') === LOG_SECRET_REDACTION;
}

function sanitizeLogValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeRequiredLogText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    sanitized[key] = sanitizeLogValue(child);
  }
  return sanitized;
}

function sanitizeRequiredLogText(value: string): string {
  return value.replaceAll('\u0000', '');
}

function sanitizeOptionalLogText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return sanitizeRequiredLogText(value);
}

function normalizeLogResourceId(value: string | null | undefined): string | null {
  const sanitized = sanitizeOptionalLogText(value);
  if (!sanitized) {
    return null;
  }
  return UUID_PATTERN.test(sanitized) ? sanitized : null;
}

function normalizeLogResourceName(
  resourceName: string | null | undefined,
  resourceId: string | null | undefined,
  normalizedResourceId: string | null,
): string | null {
  const explicitName = sanitizeOptionalLogText(resourceName);
  if (explicitName) {
    return explicitName;
  }
  if (normalizedResourceId !== null) {
    return null;
  }
  return sanitizeOptionalLogText(resourceId);
}
