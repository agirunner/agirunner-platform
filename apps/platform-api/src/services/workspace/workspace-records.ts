import { sanitizeSecretLikeRecord } from '../secret-redaction.js';
import { serializeWorkspaceSettings } from '../workspace-settings.js';
import type {
  WorkspaceListSummary,
  WorkspaceRow,
} from './workspace-types.js';

export const WORKSPACE_MEMORY_SECRET_REDACTION = 'redacted://workspace-memory-secret';
export const WORKSPACE_SETTINGS_SECRET_REDACTION = 'redacted://workspace-settings-secret';

export function byteLengthJson(value: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function sanitizeMemoryEventValue(key: string, value: unknown): unknown {
  return sanitizeSecretLikeRecord(
    { [key]: value },
    { redactionValue: WORKSPACE_MEMORY_SECRET_REDACTION, allowSecretReferences: false },
  )[key];
}

export function sanitizeMemoryForPersistence(
  memory: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeSecretLikeRecord(memory, {
    redactionValue: WORKSPACE_MEMORY_SECRET_REDACTION,
    allowSecretReferences: true,
  });
}

export function sanitizeMemoryValueForPersistence(key: string, value: unknown): unknown {
  return sanitizeSecretLikeRecord(
    { [key]: value },
    { redactionValue: WORKSPACE_MEMORY_SECRET_REDACTION, allowSecretReferences: true },
  )[key];
}

export function redactWorkspaceSecrets(workspace: WorkspaceRow): Record<string, unknown> {
  const record = workspace as Record<string, unknown>;
  const hasSecret =
    typeof record.git_webhook_secret === 'string' && record.git_webhook_secret.length > 0;
  const { git_webhook_secret: _removed, settings, memory, ...rest } = record;
  return {
    ...rest,
    settings: serializeWorkspaceSettings(settings),
    memory: sanitizeWorkspaceMemory(memory),
    git_webhook_secret_configured: hasSecret,
  };
}

export function emptyWorkspaceListSummary(): WorkspaceListSummary {
  return {
    active_workflow_count: 0,
    completed_workflow_count: 0,
    attention_workflow_count: 0,
    total_workflow_count: 0,
    last_workflow_activity_at: null,
  };
}

export function normalizeRepoUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/\.git$/, '')
    .replace(/^http:\/\//, 'https://');
}

function sanitizeWorkspaceMemory(value: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(normalizeRecord(value)).map(([key, entry]) => [
      key,
      sanitizeWorkspaceRecordValue(key, entry, WORKSPACE_MEMORY_SECRET_REDACTION),
    ]),
  );
}

function sanitizeWorkspaceRecordValue(
  key: string,
  value: unknown,
  redactionValue: string,
): unknown {
  return sanitizeSecretLikeRecord(
    { [key]: value },
    { redactionValue, allowSecretReferences: false },
  )[key];
}
