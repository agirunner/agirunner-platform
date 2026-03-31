import type { DashboardWorkspaceStorageType } from '../../lib/api.js';
import type {
  WorkspaceSecretDraft,
  WorkspaceSettingsDraft,
  WorkspaceSettingsValidation,
} from './workspace-settings-support.js';

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

export function buildWorkspaceSettingsSurfaceSummary(
  _workspace: { id: string },
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
