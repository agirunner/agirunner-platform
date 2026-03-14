import type {
  DashboardProjectPatchInput,
  DashboardProjectRecord,
  DashboardProjectSettingsInput,
  DashboardProjectSettingsRecord,
  DashboardRoleModelOverride,
} from '../../lib/api.js';

export type ProjectSecretMode = 'preserve' | 'replace' | 'clear';

export interface ProjectSecretDraft {
  configured: boolean;
  mode: ProjectSecretMode;
  value: string;
}

export interface ProjectSettingsState {
  defaultBranch: string;
  gitUserName: string;
  gitUserEmail: string;
  projectBrief: string;
  settingsExtras: Record<string, unknown>;
  modelOverrides: Record<string, DashboardRoleModelOverride>;
  credentials: {
    gitToken: { configured: boolean };
    gitSshPrivateKey: { configured: boolean };
    gitSshKnownHosts: { configured: boolean };
    webhookSecret: { configured: boolean };
  };
}

export interface ProjectSettingsDraft {
  name: string;
  slug: string;
  description: string;
  repositoryUrl: string;
  isActive: boolean;
  defaultBranch: string;
  gitUserName: string;
  gitUserEmail: string;
  projectBrief: string;
  settingsExtras: Record<string, unknown>;
  modelOverrides: Record<string, DashboardRoleModelOverride>;
  credentials: {
    gitToken: ProjectSecretDraft;
    gitSshPrivateKey: ProjectSecretDraft;
    gitSshKnownHosts: ProjectSecretDraft;
    webhookSecret: ProjectSecretDraft;
  };
}

export interface ProjectSettingsValidation {
  isValid: boolean;
  fieldErrors: Partial<Record<'name' | 'slug' | 'repositoryUrl' | 'gitUserEmail' | 'gitToken', string>>;
  blockingIssues: string[];
}

export interface ProjectSettingsSurfaceSummary {
  configuredSecretCount: number;
  configuredSecretLabel: string;
  stagedSecretChangeCount: number;
  stagedSecretChangeLabel: string;
  modelOverrideCount: number;
  modelOverrideLabel: string;
  repositoryLabel: string;
  lifecycleLabel: string;
  blockingIssueCount: number;
  blockingTitle: string;
}

export interface ProjectSecretPostureSummary {
  statusLabel: string;
  postureLabel: string;
  detail: string;
  tone: 'default' | 'warning';
}

const REDACTED_SECRET = 'redacted://project-settings-secret';
const KNOWN_SETTING_KEYS = new Set([
  'default_branch',
  'git_user_name',
  'git_user_email',
  'credentials',
  'model_overrides',
  'project_brief',
]);

export function readProjectSettings(project: DashboardProjectRecord): ProjectSettingsState {
  const settings = readSettingsRecord(project.settings);
  return {
    defaultBranch: readString(settings.default_branch),
    gitUserName: readString(settings.git_user_name),
    gitUserEmail: readString(settings.git_user_email),
    projectBrief: readString(settings.project_brief),
    settingsExtras: readSettingsExtras(settings),
    modelOverrides: readModelOverrides(settings.model_overrides),
    credentials: {
      gitToken: { configured: readConfigured(settings.credentials?.git_token_configured, settings.credentials?.git_token) },
      gitSshPrivateKey: {
        configured: readConfigured(
          settings.credentials?.git_ssh_private_key_configured,
          settings.credentials?.git_ssh_private_key,
        ),
      },
      gitSshKnownHosts: {
        configured: readConfigured(
          settings.credentials?.git_ssh_known_hosts_configured,
          settings.credentials?.git_ssh_known_hosts,
        ),
      },
      webhookSecret: {
        configured: readConfigured(
          settings.credentials?.webhook_secret_configured,
          settings.credentials?.webhook_secret,
        ),
      },
    },
  };
}

export function createProjectSettingsDraft(project: DashboardProjectRecord): ProjectSettingsDraft {
  const settings = readProjectSettings(project);
  return {
    name: project.name,
    slug: project.slug,
    description: readString(project.description),
    repositoryUrl: readString(project.repository_url),
    isActive: project.is_active !== false,
    defaultBranch: settings.defaultBranch,
    gitUserName: settings.gitUserName,
    gitUserEmail: settings.gitUserEmail,
    projectBrief: settings.projectBrief,
    settingsExtras: settings.settingsExtras,
    modelOverrides: settings.modelOverrides,
    credentials: {
      gitToken: createSecretDraft(settings.credentials.gitToken.configured),
      gitSshPrivateKey: createSecretDraft(settings.credentials.gitSshPrivateKey.configured),
      gitSshKnownHosts: createSecretDraft(settings.credentials.gitSshKnownHosts.configured),
      webhookSecret: createSecretDraft(settings.credentials.webhookSecret.configured),
    },
  };
}

export function validateProjectSettingsDraft(
  draft: ProjectSettingsDraft,
): ProjectSettingsValidation {
  const fieldErrors: ProjectSettingsValidation['fieldErrors'] = {};
  const blockingIssues: string[] = [];

  if (!draft.name.trim()) {
    fieldErrors.name = 'Project name is required.';
    blockingIssues.push(fieldErrors.name);
  }
  if (!draft.slug.trim()) {
    fieldErrors.slug = 'Project slug is required.';
    blockingIssues.push(fieldErrors.slug);
  }
  if (draft.repositoryUrl.trim() && !isValidUrl(draft.repositoryUrl.trim())) {
    fieldErrors.repositoryUrl = 'Repository URL must be a valid URL.';
    blockingIssues.push(fieldErrors.repositoryUrl);
  }
  if (draft.gitUserEmail.trim() && !isValidEmail(draft.gitUserEmail.trim())) {
    fieldErrors.gitUserEmail = 'Git identity email must be a valid email.';
    blockingIssues.push(fieldErrors.gitUserEmail);
  }
  if (draft.credentials.gitToken.mode === 'replace' && !draft.credentials.gitToken.value.trim()) {
    fieldErrors.gitToken = 'Enter a new value for Git token before saving.';
    blockingIssues.push(fieldErrors.gitToken);
  }

  return {
    isValid: blockingIssues.length === 0,
    fieldErrors,
    blockingIssues,
  };
}

export function buildProjectSettingsPatch(
  project: DashboardProjectRecord,
  draft: ProjectSettingsDraft,
): DashboardProjectPatchInput {
  const current = readProjectSettings(project);

  return {
    name: draft.name.trim(),
    slug: draft.slug.trim(),
    description: emptyToUndefined(draft.description),
    repository_url: emptyToUndefined(draft.repositoryUrl),
    is_active: draft.isActive,
    settings: {
      ...draft.settingsExtras,
      default_branch: draft.defaultBranch.trim(),
      git_user_name: draft.gitUserName.trim(),
      git_user_email: draft.gitUserEmail.trim(),
      credentials: {
        git_token: resolveSecretInput(draft.credentials.gitToken, current.credentials.gitToken.configured),
        git_token_configured: resolveSecretConfigured(draft.credentials.gitToken, current.credentials.gitToken.configured),
        git_ssh_private_key: resolveSecretInput(
          draft.credentials.gitSshPrivateKey,
          current.credentials.gitSshPrivateKey.configured,
        ),
        git_ssh_private_key_configured: resolveSecretConfigured(
          draft.credentials.gitSshPrivateKey,
          current.credentials.gitSshPrivateKey.configured,
        ),
        git_ssh_known_hosts: resolveSecretInput(
          draft.credentials.gitSshKnownHosts,
          current.credentials.gitSshKnownHosts.configured,
        ),
        git_ssh_known_hosts_configured: resolveSecretConfigured(
          draft.credentials.gitSshKnownHosts,
          current.credentials.gitSshKnownHosts.configured,
        ),
        webhook_secret: resolveSecretInput(
          draft.credentials.webhookSecret,
          current.credentials.webhookSecret.configured,
        ),
        webhook_secret_configured: resolveSecretConfigured(
          draft.credentials.webhookSecret,
          current.credentials.webhookSecret.configured,
        ),
      },
      model_overrides: draft.modelOverrides,
      project_brief: draft.projectBrief.trim(),
    } satisfies DashboardProjectSettingsInput,
  };
}

export function buildProjectSettingsSurfaceSummary(
  project: DashboardProjectRecord,
  draft: ProjectSettingsDraft,
  validation: ProjectSettingsValidation,
): ProjectSettingsSurfaceSummary {
  const configuredSecretCount = Object.values(draft.credentials).filter(
    (credential) => credential.configured,
  ).length;
  const stagedSecretChangeCount = Object.values(draft.credentials).filter(
    (credential) => credential.mode !== 'preserve',
  ).length;
  const modelOverrideCount = Object.keys(readProjectSettings(project).modelOverrides).length;

  return {
    configuredSecretCount,
    configuredSecretLabel: `${configuredSecretCount} ${pluralize(configuredSecretCount, 'secret')} configured`,
    stagedSecretChangeCount,
    stagedSecretChangeLabel:
      stagedSecretChangeCount > 0
        ? `${stagedSecretChangeCount} ${pluralize(stagedSecretChangeCount, 'secret change')} staged`
        : 'No secret changes staged',
    modelOverrideCount,
    modelOverrideLabel:
      modelOverrideCount > 0
        ? `${modelOverrideCount} ${pluralize(modelOverrideCount, 'role override')}`
        : 'Shared model posture',
    repositoryLabel: draft.repositoryUrl.trim() ? 'Repository linked' : 'Repository optional',
    lifecycleLabel: draft.isActive ? 'Active project' : 'Inactive project',
    blockingIssueCount: validation.blockingIssues.length,
    blockingTitle: 'Resolve before saving',
  };
}

export function hasProjectModelOverrides(project: DashboardProjectRecord): boolean {
  return Object.keys(readProjectSettings(project).modelOverrides).length > 0;
}

export function buildProjectSecretPostureSummary(
  draft: ProjectSecretDraft,
): ProjectSecretPostureSummary {
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

export function summarizeProjectBrief(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'No project brief saved yet.';
  }

  const preview = trimmed.split('\n').find((line) => line.trim().length > 0) ?? trimmed;
  return preview.length > 96 ? `${preview.slice(0, 93)}...` : preview;
}

function createSecretDraft(configured: boolean): ProjectSecretDraft {
  return {
    configured,
    mode: 'preserve',
    value: '',
  };
}

function readSettingsRecord(value: unknown): DashboardProjectSettingsRecord {
  const record = asRecord(value);
  return {
    ...record,
    credentials: asRecord(record.credentials),
    model_overrides: readModelOverrides(record.model_overrides),
  } as DashboardProjectSettingsRecord;
}

function readSettingsExtras(settings: DashboardProjectSettingsRecord): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !KNOWN_SETTING_KEYS.has(key)),
  );
}

function readModelOverrides(value: unknown): Record<string, DashboardRoleModelOverride> {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record).filter(([, override]) => {
      const next = asRecord(override);
      return Boolean(readString(next.provider) && readString(next.model));
    }),
  ) as Record<string, DashboardRoleModelOverride>;
}

function resolveSecretInput(draft: ProjectSecretDraft, configured: boolean): string | null {
  if (draft.mode === 'clear') {
    return null;
  }
  if (draft.mode === 'replace') {
    return draft.value.trim();
  }
  return configured ? REDACTED_SECRET : null;
}

function resolveSecretConfigured(draft: ProjectSecretDraft, configured: boolean): boolean {
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

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
