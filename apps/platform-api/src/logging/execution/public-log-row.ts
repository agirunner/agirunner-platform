import type { LogRow } from './log-service.js';
import { sanitizeSecretLikeValue } from '../../services/secret-redaction.js';

export interface PublicLogRow extends LogRow {
  stage_name: string | null;
}

export interface PublicLogSummaryRow extends Omit<PublicLogRow, 'payload' | 'error'> {
  payload: null;
  error: { code?: string; message: string } | null;
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
  'workspace_id',
  'workflow_id',
  'task_id',
  'work_item_id',
  'stage_name',
  'activation_id',
  'is_orchestrator_task',
  'execution_backend',
  'tool_owner',
  'actor_type',
  'actor_id',
  'actor_name',
  'resource_type',
  'resource_id',
  'resource_name',
  'execution_environment_id',
  'execution_environment_name',
  'execution_environment_image',
  'execution_environment_distro',
  'execution_environment_package_manager',
  'trace_id',
  'span_id',
  'error',
  'payload',
] as const;

const LOG_SECRET_REDACTION = '[REDACTED]';
const LOG_SECRET_REDACTION_OPTIONS = {
  redactionValue: LOG_SECRET_REDACTION,
  allowSecretReferences: false,
} as const;

export function toPublicLogRow(row: LogRow): PublicLogRow {
  return {
    ...row,
    payload: redactPayload(row.payload),
    error: redactError(row.error),
    stage_name: row.stage_name ?? null,
  };
}

export function toPublicLogSummaryRow(row: LogRow): PublicLogSummaryRow {
  const publicRow = toPublicLogRow(row);
  return {
    ...publicRow,
    payload: null,
    error: publicRow.error
      ? {
          ...(publicRow.error.code ? { code: publicRow.error.code } : {}),
          message: publicRow.error.message,
        }
      : null,
  };
}

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
  'max_output_tokens_omission_reason',
  'reasoning_tokens',
  'tokens_before',
  'tokens_after',
  'tokens_saved',
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
