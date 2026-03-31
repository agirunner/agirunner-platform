import {
  buildWorkspaceSecretPostureSummary,
  type WorkspaceSettingsDraft,
} from './workspace-settings-support.js';

export function buildStorageSummary(draft: WorkspaceSettingsDraft, storageLabel: string): string {
  if (draft.storageType === 'host_directory') {
    if (!draft.hostPath.trim()) {
      return `${storageLabel} • Path required`;
    }
    return `${storageLabel} • ${draft.hostPath.trim()} • ${draft.readOnly ? 'Read-only' : 'Read-write'}`;
  }
  if (draft.storageType === 'workspace_artifacts') {
    return `${storageLabel} • Explicit artifact persistence`;
  }

  const gitTokenSummary = buildWorkspaceSecretPostureSummary(draft.credentials.gitToken);
  if (!draft.repositoryUrl.trim()) {
    return `${storageLabel} • Repository required`;
  }

  const details = [storageLabel, draft.repositoryUrl.trim()];
  if (draft.defaultBranch.trim()) {
    details.push(`Branch ${draft.defaultBranch.trim()}`);
  }
  if (draft.gitUserEmail.trim()) {
    details.push('Author identity ready');
  }
  details.push(`Git token ${gitTokenSummary.postureLabel.toLowerCase()}`);
  return details.join(' • ');
}
