import { z } from 'zod';

import { ValidationError } from '../errors/domain-errors.js';
import { normalizeStoredProviderSecret } from '../lib/oauth-crypto.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';

const MAX_SHORT_TEXT_LENGTH = 255;
const MAX_EMAIL_LENGTH = 320;
const MAX_SECRET_LENGTH = 20_000;
const MAX_WORKSPACE_BRIEF_LENGTH = 20_000;
const MAX_PATH_LENGTH = 4_096;
const WORKSPACE_SETTINGS_SECRET_REDACTION = 'redacted://workspace-settings-secret';
const WORKSPACE_SETTINGS_KNOWN_KEYS = new Set([
  'workspace_storage_type',
  'workspace_storage',
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

export interface StoredWorkspaceSettingsCredentials {
  git_token?: string;
}

export const WORKSPACE_STORAGE_TYPES = [
  'git_remote',
  'host_directory',
  'workspace_artifacts',
] as const;

export type WorkspaceStorageType = (typeof WORKSPACE_STORAGE_TYPES)[number];

export interface StoredWorkspaceStorage extends Record<string, unknown> {
  repository_url?: string;
  default_branch?: string;
  git_user_name?: string;
  git_user_email?: string;
  host_path?: string;
  read_only?: boolean;
}

export interface StoredWorkspaceSettings extends Record<string, unknown> {
  workspace_storage_type?: WorkspaceStorageType;
  workspace_storage?: StoredWorkspaceStorage;
  default_branch?: string;
  git_user_name?: string;
  git_user_email?: string;
  credentials: StoredWorkspaceSettingsCredentials;
  workspace_brief?: string;
}

export interface WorkspaceRepositorySettings {
  defaultBranch: string | null;
  gitUserName: string | null;
  gitUserEmail: string | null;
  gitTokenSecretRef: string | null;
}

export interface WorkspaceStorageSettings {
  type: WorkspaceStorageType;
  repositoryUrl: string | null;
  defaultBranch: string | null;
  gitUserName: string | null;
  gitUserEmail: string | null;
  hostPath: string | null;
  readOnly: boolean;
  gitTokenSecretRef: string | null;
}

interface ParseWorkspaceSettingsOptions {
  existing?: StoredWorkspaceSettings;
  rejectRetiredOverrides?: boolean;
}

export function normalizeWorkspaceSettings(value: unknown): StoredWorkspaceSettings {
  return parseWorkspaceSettings(value, { rejectRetiredOverrides: false });
}

export function parseWorkspaceSettingsInput(
  value: unknown,
  existing?: StoredWorkspaceSettings,
): StoredWorkspaceSettings {
  return parseWorkspaceSettings(value, { existing, rejectRetiredOverrides: true });
}

export function readWorkspaceSettingsExtras(value: unknown): Record<string, unknown> {
  return stripKnownWorkspaceSettingKeys(normalizeWorkspaceSettings(value));
}

export function readWorkspaceRepositorySettings(value: unknown): WorkspaceRepositorySettings {
  const storage = readWorkspaceStorageSettings(value);
  const settings = normalizeWorkspaceSettings(value);
  return {
    defaultBranch: storage.defaultBranch ?? settings.default_branch ?? null,
    gitUserName: storage.gitUserName ?? settings.git_user_name ?? null,
    gitUserEmail: storage.gitUserEmail ?? settings.git_user_email ?? null,
    gitTokenSecretRef: storage.gitTokenSecretRef ?? settings.credentials.git_token ?? null,
  };
}

export function readWorkspaceStorageSettings(value: unknown): WorkspaceStorageSettings {
  const settings = normalizeWorkspaceSettings(value);
  const storageType = settings.workspace_storage_type ?? 'workspace_artifacts';
  const storage = asRecord(settings.workspace_storage);
  const legacyRepositorySettings = {
    defaultBranch: settings.default_branch ?? null,
    gitUserName: settings.git_user_name ?? null,
    gitUserEmail: settings.git_user_email ?? null,
  };
  if (storageType === 'git_remote') {
    return {
      type: storageType,
      repositoryUrl: readNullableString(storage.repository_url),
      defaultBranch: readNullableString(storage.default_branch) ?? legacyRepositorySettings.defaultBranch,
      gitUserName: readNullableString(storage.git_user_name) ?? legacyRepositorySettings.gitUserName,
      gitUserEmail: readNullableString(storage.git_user_email) ?? legacyRepositorySettings.gitUserEmail,
      hostPath: null,
      readOnly: false,
      gitTokenSecretRef: settings.credentials.git_token ?? null,
    };
  }
  if (storageType === 'host_directory') {
    return {
      type: storageType,
      repositoryUrl: null,
      defaultBranch: null,
      gitUserName: null,
      gitUserEmail: null,
      hostPath: readNullableString(storage.host_path),
      readOnly: storage.read_only === true,
      gitTokenSecretRef: null,
    };
  }
  return {
    type: 'workspace_artifacts',
    repositoryUrl: null,
    defaultBranch: null,
    gitUserName: null,
    gitUserEmail: null,
    hostPath: null,
    readOnly: false,
    gitTokenSecretRef: null,
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
    ...(settings.workspace_storage_type
      ? { workspace_storage_type: settings.workspace_storage_type }
      : {}),
    ...(settings.workspace_storage && Object.keys(settings.workspace_storage).length > 0
      ? { workspace_storage: settings.workspace_storage }
      : {}),
    ...(settings.default_branch ? { default_branch: settings.default_branch } : {}),
    ...(settings.git_user_name ? { git_user_name: settings.git_user_name } : {}),
    ...(settings.git_user_email ? { git_user_email: settings.git_user_email } : {}),
    credentials: serializeCredentialPosture(settings.credentials),
    ...(settings.workspace_brief ? { workspace_brief: settings.workspace_brief } : {}),
    ...extras,
  };
}

function parseWorkspaceSettings(
  value: unknown,
  options: ParseWorkspaceSettingsOptions,
): StoredWorkspaceSettings {
  const record = asRecord(value);

  if (options.rejectRetiredOverrides && record.model_override !== undefined) {
    throw new ValidationError('settings.model_override is no longer supported');
  }
  if (options.rejectRetiredOverrides && record.model_overrides !== undefined) {
    throw new ValidationError('settings.model_overrides is no longer supported');
  }

  const existing = options.existing ? normalizeWorkspaceSettings(options.existing) : emptyWorkspaceSettings();
  const storage = readWorkspaceStorage(record, existing);

  const defaultBranch = readOptionalString(record.default_branch, 'settings.default_branch');
  const gitUserName = readOptionalString(record.git_user_name, 'settings.git_user_name');
  const gitUserEmail = readOptionalEmail(record.git_user_email, 'settings.git_user_email');
  const workspaceBrief = readOptionalLongText(record.workspace_brief, 'settings.workspace_brief');
  const credentials = readCredentials(record, existing.credentials);

  return {
    ...stripKnownWorkspaceSettingKeys(record),
    ...(storage.persist ? { workspace_storage_type: storage.type } : {}),
    ...(storage.persist && Object.keys(storage.settings).length > 0 ? { workspace_storage: storage.settings } : {}),
    ...(defaultBranch ? { default_branch: defaultBranch } : {}),
    ...(gitUserName ? { git_user_name: gitUserName } : {}),
    ...(gitUserEmail ? { git_user_email: gitUserEmail } : {}),
    credentials,
    ...(workspaceBrief ? { workspace_brief: workspaceBrief } : {}),
  };
}

function emptyWorkspaceSettings(): StoredWorkspaceSettings {
  return {
    credentials: {},
  };
}

function readWorkspaceStorage(
  record: Record<string, unknown>,
  existing: StoredWorkspaceSettings,
): { type: WorkspaceStorageType; settings: StoredWorkspaceStorage; persist: boolean } {
  const explicitType = readWorkspaceStorageType(record.workspace_storage_type, 'settings.workspace_storage_type');
  const existingType = readWorkspaceStorageType(existing.workspace_storage_type, 'settings.workspace_storage_type');
  const type = explicitType ?? existingType ?? 'workspace_artifacts';
  const storageRecord = asRecord(record.workspace_storage);
  const existingStorage = asRecord(existing.workspace_storage);
  const persist =
    explicitType !== undefined
    || existingType !== undefined
    || Object.keys(storageRecord).length > 0
    || Object.keys(existingStorage).length > 0;

  if (type === 'git_remote') {
    const repositoryURL = readOptionalUrl(
      storageRecord.repository_url ?? existingStorage.repository_url,
      'settings.workspace_storage.repository_url',
    );
    const defaultBranch = readOptionalString(
      storageRecord.default_branch ?? existingStorage.default_branch ?? record.default_branch,
      'settings.workspace_storage.default_branch',
    );
    const gitUserName = readOptionalString(
      storageRecord.git_user_name ?? existingStorage.git_user_name ?? record.git_user_name,
      'settings.workspace_storage.git_user_name',
    );
    const gitUserEmail = readOptionalEmail(
      storageRecord.git_user_email ?? existingStorage.git_user_email ?? record.git_user_email,
      'settings.workspace_storage.git_user_email',
    );
    return {
      type,
      persist,
      settings: {
        ...(repositoryURL ? { repository_url: repositoryURL } : {}),
        ...(defaultBranch ? { default_branch: defaultBranch } : {}),
        ...(gitUserName ? { git_user_name: gitUserName } : {}),
        ...(gitUserEmail ? { git_user_email: gitUserEmail } : {}),
      },
    };
  }

  if (type === 'host_directory') {
    const hostPath = readRequiredAbsolutePath(
      storageRecord.host_path ?? existingStorage.host_path,
      'settings.workspace_storage.host_path',
    );
    const readOnly = readOptionalBoolean(
      storageRecord.read_only ?? existingStorage.read_only,
      'settings.workspace_storage.read_only',
    );
    return {
      type,
      persist,
      settings: {
        host_path: hostPath,
        ...(readOnly !== undefined ? { read_only: readOnly } : {}),
      },
    };
  }

  return {
    type: 'workspace_artifacts',
    persist,
    settings: {},
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

  return input.provided.length > 0
    ? normalizeStoredProviderSecret(input.provided)
    : undefined;
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

function readOptionalUrl(value: unknown, label: string): string | undefined {
  const normalized = readOptionalString(value, label);
  if (!normalized) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new ValidationError(`${label} must be a valid URL`);
  }
  return parsed.toString();
}

function readRequiredAbsolutePath(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${label} is required`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ValidationError(`${label} is required`);
  }
  if (!normalized.startsWith('/')) {
    throw new ValidationError(`${label} must be an absolute path`);
  }
  if (normalized.length > MAX_PATH_LENGTH) {
    throw new ValidationError(`${label} must be at most ${MAX_PATH_LENGTH} characters`);
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

function readWorkspaceStorageType(
  value: unknown,
  label: string,
): WorkspaceStorageType | undefined {
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
  if ((WORKSPACE_STORAGE_TYPES as readonly string[]).includes(normalized)) {
    return normalized as WorkspaceStorageType;
  }
  throw new ValidationError(
    `${label} must be one of ${WORKSPACE_STORAGE_TYPES.join(', ')}`,
  );
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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
