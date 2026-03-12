import type { LogRow } from './log-service.js';

export interface PublicLogRow extends LogRow {
  stage_name: string | null;
}

export const PUBLIC_LOG_CSV_COLUMNS = [
  'id',
  'created_at',
  'source',
  'category',
  'level',
  'operation',
  'status',
  'duration_ms',
  'project_id',
  'workflow_id',
  'task_id',
  'work_item_id',
  'stage_name',
  'activation_id',
  'is_orchestrator_task',
  'actor_type',
  'actor_id',
  'actor_name',
  'resource_type',
  'resource_id',
  'resource_name',
  'trace_id',
  'span_id',
  'error',
  'payload',
] as const;

export function toPublicLogRow(row: LogRow): PublicLogRow {
  return {
    ...row,
    payload: redactPayload(row.payload),
    error: redactError(row.error),
    stage_name: row.stage_name ?? null,
  };
}

const SECRET_PATTERN =
  /(?:api[_-]?key|password|secret|(?:^|[_-])token(?!s)|authorization|bearer|credential|private[_-]?key)/i;
const SECRET_VALUE_PATTERN =
  /(?:^enc:v\d+:|^secret:|^redacted:\/\/|^Bearer\s+\S+|^sk-[A-Za-z0-9_-]+|^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i;

const REDACT_EXEMPT_KEYS = new Set([
  'system_prompt',
  'prompt_summary',
  'response_summary',
  'description',
]);

function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload ?? {})) {
    redacted[key] = redactValue(key, value);
  }
  return redacted;
}

function redactError(error: LogRow['error']): LogRow['error'] {
  if (!error) {
    return null;
  }
  return {
    ...(error.code ? { code: error.code } : {}),
    message: redactString('message', error.message),
    ...(error.stack ? { stack: redactString('stack', error.stack) } : {}),
  };
}

function redactValue(key: string, value: unknown): unknown {
  if (SECRET_PATTERN.test(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    return redactString(key, value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(key, item));
  }
  if (value && typeof value === 'object') {
    return redactPayload(value as Record<string, unknown>);
  }
  return value;
}

function redactString(key: string, value: string): string {
  if (REDACT_EXEMPT_KEYS.has(key)) {
    return value;
  }
  return SECRET_PATTERN.test(value) || SECRET_VALUE_PATTERN.test(value) ? '[REDACTED]' : value;
}
