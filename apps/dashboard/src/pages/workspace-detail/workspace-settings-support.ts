import type {
  DashboardWorkspaceGitAccessVerifyInput,
  DashboardWorkspacePatchInput,
  DashboardWorkspaceRecord,
  DashboardWorkspaceSettingsInput,
  DashboardWorkspaceSettingsRecord,
  DashboardWorkspaceStorageType,
} from '../../lib/api.js';

export type WorkspaceSecretMode = 'preserve' | 'replace' | 'clear';

export interface WorkspaceSecretDraft {
  configured: boolean;
  mode: WorkspaceSecretMode;
  value: string;
}

export interface WorkspaceSettingsState {
  storageType: DashboardWorkspaceStorageType;
  repositoryUrl: string;
  defaultBranch: string;
  gitUserName: string;
  gitUserEmail: string;
  hostPath: string;
  readOnly: boolean;
  settingsExtras: Record<string, unknown>;
  credentials: {
    gitToken: { configured: boolean };
  };
}

export interface WorkspaceSettingsDraft {
  name: string;
  slug: string;
  description: string;
  storageType: DashboardWorkspaceStorageType;
  isActive: boolean;
  repositoryUrl: string;
  defaultBranch: string;
  gitUserName: string;
  gitUserEmail: string;
  hostPath: string;
  readOnly: boolean;
  settingsExtras: Record<string, unknown>;
  credentials: {
    gitToken: WorkspaceSecretDraft;
  };
}

export interface WorkspaceSettingsValidation {
  isValid: boolean;
  fieldErrors: Partial<Record<'name' | 'slug' | 'repositoryUrl' | 'gitUserEmail' | 'gitToken' | 'hostPath', string>>;
  blockingIssues: string[];
}

export interface WorkspaceSettingsSurfaceSummary {
  configuredSecretCount: number;
  configuredSecretLabel: string;
  stagedSecretChangeCount: number;
  stagedSecretChangeLabel: string;
  storageLabel: string;
  lifecycleLabel: string;
  blockingIssueCount: number;
  blockingTitle: string;
}

export interface WorkspaceSecretPostureSummary {
  statusLabel: string;
  postureLabel: string;
  detail: string;
  tone: 'default' | 'warning';
}

const REDACTED_SECRET = 'redacted://workspace-settings-secret';
const WORKSPACE_GIT_VERIFICATION_ERROR_FALLBACK =
  'Git access verification failed before saving workspace settings.';
const KNOWN_SETTING_KEYS = new Set([
  'workspace_storage_type',
  'workspace_storage',
  'default_branch',
  'git_user_name',
  'git_user_email',
  'credentials',
  'model_overrides',
]);

export function readWorkspaceSettings(workspace: DashboardWorkspaceRecord): WorkspaceSettingsState {
  const settings = readSettingsRecord(workspace.settings);
  const storageType = readStorageType(settings, workspace.repository_url);
  const storage = asRecord(settings.workspace_storage);
  return {
    storageType,
    repositoryUrl:
      storageType === 'git_remote'
        ? readString(storage.repository_url) || readString(workspace.repository_url)
        : '',
    defaultBranch:
      storageType === 'git_remote'
        ? readString(storage.default_branch) || readString(settings.default_branch)
        : '',
    gitUserName:
      storageType === 'git_remote'
        ? readString(storage.git_user_name) || readString(settings.git_user_name)
        : '',
    gitUserEmail:
      storageType === 'git_remote'
        ? readString(storage.git_user_email) || readString(settings.git_user_email)
        : '',
    hostPath: storageType === 'host_directory' ? readString(storage.host_path) : '',
    readOnly: storageType === 'host_directory' ? storage.read_only === true : false,
    settingsExtras: readSettingsExtras(settings),
    credentials: {
      gitToken: {
        configured: readConfigured(
          settings.credentials?.git_token_configured,
          settings.credentials?.git_token,
        ),
      },
    },
  };
}

export function createWorkspaceSettingsDraft(workspace: DashboardWorkspaceRecord): WorkspaceSettingsDraft {
  const settings = readWorkspaceSettings(workspace);
  return {
    name: workspace.name,
    slug: workspace.slug,
    description: readString(workspace.description),
    storageType: settings.storageType,
    isActive: workspace.is_active !== false,
    repositoryUrl: settings.repositoryUrl,
    defaultBranch: settings.defaultBranch,
    gitUserName: settings.gitUserName,
    gitUserEmail: settings.gitUserEmail,
    hostPath: settings.hostPath,
    readOnly: settings.readOnly,
    settingsExtras: settings.settingsExtras,
    credentials: {
      gitToken: createSecretDraft(settings.credentials.gitToken.configured),
    },
  };
}

export function validateWorkspaceSettingsDraft(
  draft: WorkspaceSettingsDraft,
): WorkspaceSettingsValidation {
  const fieldErrors: WorkspaceSettingsValidation['fieldErrors'] = {};
  const blockingIssues: string[] = [];

  if (!draft.name.trim()) {
    fieldErrors.name = 'Workspace name is required.';
    blockingIssues.push(fieldErrors.name);
  }
  if (!draft.slug.trim()) {
    fieldErrors.slug = 'Workspace slug is required.';
    blockingIssues.push(fieldErrors.slug);
  }
  if (draft.storageType === 'git_remote') {
    if (!draft.repositoryUrl.trim()) {
      fieldErrors.repositoryUrl = 'Repository URL is required for Git Remote.';
      blockingIssues.push(fieldErrors.repositoryUrl);
    } else if (!isValidUrl(draft.repositoryUrl.trim())) {
      fieldErrors.repositoryUrl = 'Repository URL must be a valid URL.';
      blockingIssues.push(fieldErrors.repositoryUrl);
    }
  }
  if (draft.storageType === 'git_remote' && draft.gitUserEmail.trim() && !isValidEmail(draft.gitUserEmail.trim())) {
    fieldErrors.gitUserEmail = 'Git identity email must be a valid email.';
    blockingIssues.push(fieldErrors.gitUserEmail);
  }
  if (
    draft.storageType === 'git_remote'
    && draft.credentials.gitToken.mode === 'replace'
    && !draft.credentials.gitToken.value.trim()
  ) {
    fieldErrors.gitToken = 'Enter a new value for Git token before saving.';
    blockingIssues.push(fieldErrors.gitToken);
  }
  if (draft.storageType === 'host_directory') {
    if (!draft.hostPath.trim()) {
      fieldErrors.hostPath = 'Host path is required for Host Directory.';
      blockingIssues.push(fieldErrors.hostPath);
    } else if (!draft.hostPath.trim().startsWith('/')) {
      fieldErrors.hostPath = 'Host path must be absolute.';
      blockingIssues.push(fieldErrors.hostPath);
    }
  }

  return {
    isValid: blockingIssues.length === 0,
    fieldErrors,
    blockingIssues,
  };
}

export function buildWorkspaceSettingsPatch(
  workspace: DashboardWorkspaceRecord,
  draft: WorkspaceSettingsDraft,
): DashboardWorkspacePatchInput {
  const current = readWorkspaceSettings(workspace);

  return {
    name: draft.name.trim(),
    slug: draft.slug.trim(),
    description: emptyToUndefined(draft.description),
    is_active: draft.isActive,
    settings: {
      ...draft.settingsExtras,
      workspace_storage_type: draft.storageType,
      workspace_storage: buildWorkspaceStorageRecord(draft),
      ...(draft.storageType === 'git_remote' && draft.defaultBranch.trim()
        ? { default_branch: draft.defaultBranch.trim() }
        : {}),
      ...(draft.storageType === 'git_remote' && draft.gitUserName.trim()
        ? { git_user_name: draft.gitUserName.trim() }
        : {}),
      ...(draft.storageType === 'git_remote' && draft.gitUserEmail.trim()
        ? { git_user_email: draft.gitUserEmail.trim() }
        : {}),
      credentials: {
        git_token: resolveSecretInput(
          draft.credentials.gitToken,
          current.credentials.gitToken.configured,
        ),
        git_token_configured: resolveSecretConfigured(
          draft.credentials.gitToken,
          current.credentials.gitToken.configured,
        ),
      },
    } satisfies DashboardWorkspaceSettingsInput,
  };
}

export function buildWorkspaceSettingsSurfaceSummary(
  workspace: DashboardWorkspaceRecord,
  draft: WorkspaceSettingsDraft,
  validation: WorkspaceSettingsValidation,
): WorkspaceSettingsSurfaceSummary {
  const configuredSecretCount = Object.values(draft.credentials).filter(
    (credential) => credential.configured,
  ).length;
  const stagedSecretChangeCount = Object.values(draft.credentials).filter(
    (credential) => credential.mode !== 'preserve',
  ).length;

  return {
    configuredSecretCount,
    configuredSecretLabel: `${configuredSecretCount} ${pluralize(configuredSecretCount, 'secret')} configured`,
    stagedSecretChangeCount,
    stagedSecretChangeLabel:
      stagedSecretChangeCount > 0
        ? `${stagedSecretChangeCount} ${pluralize(stagedSecretChangeCount, 'secret change')} staged`
        : 'No secret changes staged',
    storageLabel: storageLabel(draft.storageType),
    lifecycleLabel: draft.isActive ? 'Active workspace' : 'Inactive workspace',
    blockingIssueCount: validation.blockingIssues.length,
    blockingTitle: 'Resolve before saving',
  };
}

export function requiresWorkspaceGitAccessVerification(
  workspace: DashboardWorkspaceRecord,
  draft: WorkspaceSettingsDraft,
): boolean {
  if (draft.storageType !== 'git_remote') {
    return false;
  }

  const current = readWorkspaceSettings(workspace);
  if (current.storageType !== 'git_remote') {
    return true;
  }

  if (normalizeDraftText(current.repositoryUrl) !== normalizeDraftText(draft.repositoryUrl)) {
    return true;
  }

  if (normalizeDraftText(current.defaultBranch) !== normalizeDraftText(draft.defaultBranch)) {
    return true;
  }

  if (draft.credentials.gitToken.mode === 'replace') {
    return true;
  }

  if (draft.credentials.gitToken.mode === 'clear') {
    return current.credentials.gitToken.configured;
  }

  return false;
}

export function buildWorkspaceGitAccessVerificationInput(
  draft: WorkspaceSettingsDraft,
): DashboardWorkspaceGitAccessVerifyInput {
  return {
    repository_url: draft.repositoryUrl.trim(),
    ...(draft.defaultBranch.trim() ? { default_branch: draft.defaultBranch.trim() } : {}),
    git_token_mode: draft.credentials.gitToken.mode,
    ...(draft.credentials.gitToken.mode === 'replace' && draft.credentials.gitToken.value.trim()
      ? { git_token: draft.credentials.gitToken.value.trim() }
      : {}),
  };
}

export function buildWorkspaceGitAccessVerificationFingerprint(
  draft: WorkspaceSettingsDraft,
): string {
  return JSON.stringify({
    storageType: draft.storageType,
    repositoryUrl: draft.repositoryUrl.trim(),
    defaultBranch: draft.defaultBranch.trim(),
    gitTokenMode: draft.credentials.gitToken.mode,
    gitTokenValue:
      draft.credentials.gitToken.mode === 'replace'
        ? draft.credentials.gitToken.value.trim()
        : '',
  });
}

export function formatWorkspaceGitVerificationErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message.trim() : '';
  const message = rawMessage.replace(/^HTTP\s+\d+(?::\s*)?/i, '').trim();
  return message || WORKSPACE_GIT_VERIFICATION_ERROR_FALLBACK;
}

export function buildWorkspaceSecretPostureSummary(
  draft: WorkspaceSecretDraft,
): WorkspaceSecretPostureSummary {
  const statusLabel = draft.configured ? 'Configured' : 'Not configured';

  if (draft.mode === 'clear') {
    return {
      statusLabel,
      postureLabel: 'Clears on save',
      detail: 'Stored value will be cleared on save.',
      tone: 'warning',
    };
  }

  if (draft.mode === 'replace') {
    const hasValue = draft.value.trim().length > 0;
    return {
      statusLabel,
      postureLabel: 'Updates on save',
      detail: hasValue ? 'New value staged for save.' : 'Enter a new value before saving.',
      tone: hasValue ? 'default' : 'warning',
    };
  }

  return {
    statusLabel,
    postureLabel: draft.configured ? 'No change' : 'Still empty',
    detail: draft.configured ? 'Stored value will stay unchanged.' : 'No stored value yet.',
    tone: 'default',
  };
}

export function summarizeWorkspaceContext(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'No workspace context saved yet.';
  }

  const preview = trimmed.split('\n').find((line) => line.trim().length > 0) ?? trimmed;
  return preview.length > 96 ? `${preview.slice(0, 93)}...` : preview;
}

export const summarizeWorkspaceBrief = summarizeWorkspaceContext;

function createSecretDraft(configured: boolean): WorkspaceSecretDraft {
  return {
    configured,
    mode: 'preserve',
    value: '',
  };
}

function readSettingsRecord(value: unknown): DashboardWorkspaceSettingsRecord {
  const record = asRecord(value);
  return {
    ...record,
    credentials: asRecord(record.credentials),
    workspace_storage: asRecord(record.workspace_storage),
  } as DashboardWorkspaceSettingsRecord;
}

function readSettingsExtras(settings: DashboardWorkspaceSettingsRecord): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !KNOWN_SETTING_KEYS.has(key)),
  );
}

function resolveSecretInput(draft: WorkspaceSecretDraft, configured: boolean): string | null {
  if (draft.mode === 'clear') {
    return null;
  }
  if (draft.mode === 'replace') {
    return draft.value.trim();
  }
  return configured ? REDACTED_SECRET : null;
}

function resolveSecretConfigured(draft: WorkspaceSecretDraft, configured: boolean): boolean {
  if (draft.mode === 'clear') {
    return false;
  }
  if (draft.mode === 'replace') {
    return draft.value.trim().length > 0;
  }
  return configured;
}

function readConfigured(configuredValue: unknown, value: unknown): boolean {
  return Boolean(configuredValue) || readString(value).length > 0;
}

function buildWorkspaceStorageRecord(
  draft: WorkspaceSettingsDraft,
): NonNullable<DashboardWorkspaceSettingsInput['workspace_storage']> {
  switch (draft.storageType) {
    case 'git_remote':
      return {
        repository_url: emptyToUndefined(draft.repositoryUrl),
        default_branch: emptyToUndefined(draft.defaultBranch),
        git_user_name: emptyToUndefined(draft.gitUserName),
        git_user_email: emptyToUndefined(draft.gitUserEmail),
      };
    case 'host_directory':
      return {
        host_path: emptyToUndefined(draft.hostPath),
        read_only: draft.readOnly,
      };
    default:
      return {};
  }
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeDraftText(value: string): string {
  return value.trim();
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readStorageType(
  settings: DashboardWorkspaceSettingsRecord,
  repositoryUrl: string | null | undefined,
): DashboardWorkspaceStorageType {
  const configuredType = readString(settings.workspace_storage_type);
  if (configuredType === 'git_remote' || configuredType === 'host_directory' || configuredType === 'workspace_artifacts') {
    return configuredType;
  }
  return readString(repositoryUrl) ? 'git_remote' : 'workspace_artifacts';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function storageLabel(value: DashboardWorkspaceStorageType): string {
  switch (value) {
    case 'git_remote':
      return 'Git Remote';
    case 'host_directory':
      return 'Host Directory';
    default:
      return 'Workspace Artifacts';
  }
}
