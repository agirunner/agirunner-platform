import { z } from 'zod';

import { ValidationError } from '../errors/domain-errors.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';

const MAX_SHORT_TEXT_LENGTH = 255;
const MAX_EMAIL_LENGTH = 320;
const MAX_SECRET_LENGTH = 20_000;
const MAX_WORKSPACE_BRIEF_LENGTH = 20_000;
const WORKSPACE_SETTINGS_SECRET_REDACTION = 'redacted://workspace-settings-secret';
const WORKSPACE_SETTINGS_KNOWN_KEYS = new Set([
  'default_branch',
  'git_user_name',
  'git_user_email',
  'credentials',
  'model_overrides',
  'workspace_brief',
  'git_token_secret_ref',
  'model_override',
]);

const emailSchema = z.string().email().max(MAX_EMAIL_LENGTH);

export const workspaceRoleModelOverrideSchema = z.object({
  provider: z.string().min(1).max(120),
  model: z.string().min(1).max(200),
  reasoning_config: z.record(z.unknown()).nullable().optional(),
});

export const workspaceModelOverridesSchema = z.record(
  z.string().min(1).max(120),
  workspaceRoleModelOverrideSchema,
);

export interface StoredWorkspaceSettingsCredentials {
  git_token?: string;
}

export interface StoredWorkspaceSettings extends Record<string, unknown> {
  default_branch?: string;
  git_user_name?: string;
  git_user_email?: string;
  credentials: StoredWorkspaceSettingsCredentials;
  model_overrides: Record<string, WorkspaceRoleModelOverride>;
  workspace_brief?: string;
}

export interface WorkspaceRoleModelOverride {
  provider: string;
  model: string;
  reasoning_config?: Record<string, unknown> | null;
}

export interface WorkspaceRepositorySettings {
  defaultBranch: string | null;
  gitUserName: string | null;
  gitUserEmail: string | null;
  gitTokenSecretRef: string | null;
}

interface ParseWorkspaceSettingsOptions {
  existing?: StoredWorkspaceSettings;
}

export function normalizeWorkspaceSettings(value: unknown): StoredWorkspaceSettings {
  return parseWorkspaceSettings(value, {});
}

export function parseWorkspaceSettingsInput(
  value: unknown,
  existing?: StoredWorkspaceSettings,
): StoredWorkspaceSettings {
  return parseWorkspaceSettings(value, { existing });
}

export function readWorkspaceModelOverrides(value: unknown): Record<string, WorkspaceRoleModelOverride> {
  void value;
  return {};
}

export function readWorkspaceSettingsExtras(value: unknown): Record<string, unknown> {
  return stripKnownWorkspaceSettingKeys(normalizeWorkspaceSettings(value));
}

export function readWorkspaceRepositorySettings(value: unknown): WorkspaceRepositorySettings {
  const settings = normalizeWorkspaceSettings(value);
  return {
    defaultBranch: settings.default_branch ?? null,
    gitUserName: settings.git_user_name ?? null,
    gitUserEmail: settings.git_user_email ?? null,
    gitTokenSecretRef: settings.credentials.git_token ?? null,
  };
}

export function validateWorkspaceSettingsShape(value: unknown): void {
  void parseWorkspaceSettingsInput(value);
}

export function serializeWorkspaceSettings(value: unknown): Record<string, unknown> {
  const settings = normalizeWorkspaceSettings(value);
  const extras = sanitizeSecretLikeRecord(stripKnownWorkspaceSettingKeys(settings), {
    redactionValue: WORKSPACE_SETTINGS_SECRET_REDACTION,
    allowSecretReferences: false,
  });

  return {
    ...(settings.default_branch ? { default_branch: settings.default_branch } : {}),
    ...(settings.git_user_name ? { git_user_name: settings.git_user_name } : {}),
    ...(settings.git_user_email ? { git_user_email: settings.git_user_email } : {}),
    credentials: serializeCredentialPosture(settings.credentials),
    model_overrides: {},
    ...(settings.workspace_brief ? { workspace_brief: settings.workspace_brief } : {}),
    ...extras,
  };
}

function parseWorkspaceSettings(
  value: unknown,
  options: ParseWorkspaceSettingsOptions,
): StoredWorkspaceSettings {
  const record = asRecord(value);

  if (record.model_override !== undefined) {
    throw new ValidationError('settings.model_override is no longer supported');
  }

  const existing = options.existing ? normalizeWorkspaceSettings(options.existing) : emptyWorkspaceSettings();

  const defaultBranch = readOptionalString(record.default_branch, 'settings.default_branch');
  const gitUserName = readOptionalString(record.git_user_name, 'settings.git_user_name');
  const gitUserEmail = readOptionalEmail(record.git_user_email, 'settings.git_user_email');
  const projectBrief = readOptionalLongText(record.workspace_brief, 'settings.workspace_brief');
  const credentials = readCredentials(record, existing.credentials);

  return {
    ...stripKnownWorkspaceSettingKeys(record),
    ...(defaultBranch ? { default_branch: defaultBranch } : {}),
    ...(gitUserName ? { git_user_name: gitUserName } : {}),
    ...(gitUserEmail ? { git_user_email: gitUserEmail } : {}),
    credentials,
    model_overrides: {},
    ...(projectBrief ? { workspace_brief: projectBrief } : {}),
  };
}

function emptyWorkspaceSettings(): StoredWorkspaceSettings {
  return {
    credentials: {},
    model_overrides: {},
  };
}

function readCredentials(
  record: Record<string, unknown>,
  existing: StoredWorkspaceSettingsCredentials,
): StoredWorkspaceSettingsCredentials {
  const credentialsRecord = asRecord(record.credentials);
  const next: StoredWorkspaceSettingsCredentials = {};

  assignCredential(next, 'git_token', {
    provided: credentialsRecord.git_token ?? record.git_token_secret_ref,
    configured: credentialsRecord.git_token_configured,
    existing: existing.git_token,
    label: 'settings.credentials.git_token',
  });

  return next;
}

function assignCredential(
  target: StoredWorkspaceSettingsCredentials,
  key: keyof StoredWorkspaceSettingsCredentials,
  input: {
    provided: unknown;
    configured: unknown;
    existing: string | undefined;
    label: string;
  },
) {
  const value = resolveCredentialValue(input);
  if (value) {
    target[key] = value;
  }
}

function resolveCredentialValue(input: {
  provided: unknown;
  configured: unknown;
  existing: string | undefined;
  label: string;
}): string | undefined {
  const configured = readOptionalBoolean(input.configured, `${input.label}_configured`);
  if (input.provided === undefined) {
    if (configured === false) {
      return undefined;
    }
    return input.existing;
  }

  if (input.provided === null) {
    return undefined;
  }

  if (typeof input.provided !== 'string') {
    throw new ValidationError(`${input.label} must be a string`);
  }

  if (input.provided === WORKSPACE_SETTINGS_SECRET_REDACTION) {
    return input.existing;
  }

  if (input.provided.length > MAX_SECRET_LENGTH) {
    throw new ValidationError(`${input.label} must be at most ${MAX_SECRET_LENGTH} characters`);
  }

  if (/\s/.test(input.provided)) {
    throw new ValidationError(`${input.label} must not contain whitespace`);
  }

  return input.provided.length > 0 ? input.provided : undefined;
}

function readModelOverrides(value: unknown): Record<string, WorkspaceRoleModelOverride> {
  void value;
  return {};
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  if (normalized.length > MAX_SHORT_TEXT_LENGTH) {
    throw new ValidationError(`${label} must be at most ${MAX_SHORT_TEXT_LENGTH} characters`);
  }
  return normalized;
}

function readOptionalLongText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  if (normalized.length > MAX_WORKSPACE_BRIEF_LENGTH) {
    throw new ValidationError(`${label} must be at most ${MAX_WORKSPACE_BRIEF_LENGTH} characters`);
  }
  return normalized;
}

function readOptionalEmail(value: unknown, label: string): string | undefined {
  const normalized = readOptionalString(value, label);
  if (!normalized) {
    return undefined;
  }
  const parsed = emailSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new ValidationError(`${label} must be a valid email address`);
  }
  return parsed.data;
}

function readOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${label} must be a boolean`);
  }
  return value;
}

function serializeCredentialPosture(credentials: StoredWorkspaceSettingsCredentials) {
  return {
    git_token: credentials.git_token ? WORKSPACE_SETTINGS_SECRET_REDACTION : null,
    git_token_configured: Boolean(credentials.git_token),
  };
}

function stripKnownWorkspaceSettingKeys(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !WORKSPACE_SETTINGS_KNOWN_KEYS.has(key)),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
