import { readWorkspaceRepositorySettings, readWorkspaceStorageSettings } from './workspace-settings.js';

const DEFAULT_WORKING_DIRECTORY = '/workspace/repo';

export type ResolvedWorkspaceStorageBinding =
  | {
      type: 'git_remote';
      working_directory: string;
      repository_url: string | null;
      default_branch: string | null;
      git_user_name: string | null;
      git_user_email: string | null;
      git_token_secret_ref: string | null;
    }
  | {
      type: 'host_directory';
      working_directory: string;
      host_path: string;
      read_only: boolean;
    }
  | {
      type: 'workspace_artifacts';
      working_directory: string;
    };

interface ResolveWorkspaceStorageInput {
  repository_url?: unknown;
  settings?: unknown;
}

export function resolveWorkspaceStorageBinding(
  input: ResolveWorkspaceStorageInput,
): ResolvedWorkspaceStorageBinding {
  const typedStorage = readWorkspaceStorageSettings(input.settings);
  if (typedStorage.type === 'git_remote') {
    return {
      type: typedStorage.type,
      working_directory: DEFAULT_WORKING_DIRECTORY,
      repository_url: typedStorage.repositoryUrl ?? readNullableString(input.repository_url),
      default_branch: typedStorage.defaultBranch,
      git_user_name: typedStorage.gitUserName,
      git_user_email: typedStorage.gitUserEmail,
      git_token_secret_ref: typedStorage.gitTokenSecretRef,
    };
  }
  if (typedStorage.type === 'host_directory' && typedStorage.hostPath) {
    return {
      type: typedStorage.type,
      working_directory: DEFAULT_WORKING_DIRECTORY,
      host_path: typedStorage.hostPath,
      read_only: typedStorage.readOnly,
    };
  }

  const legacyRepositoryURL = readNullableString(input.repository_url);
  if (legacyRepositoryURL) {
    const legacyRepository = readWorkspaceRepositorySettings(input.settings);
    return {
      type: 'git_remote',
      working_directory: DEFAULT_WORKING_DIRECTORY,
      repository_url: legacyRepositoryURL,
      default_branch: legacyRepository.defaultBranch,
      git_user_name: legacyRepository.gitUserName,
      git_user_email: legacyRepository.gitUserEmail,
      git_token_secret_ref: legacyRepository.gitTokenSecretRef,
    };
  }

  return {
    type: 'workspace_artifacts',
    working_directory: DEFAULT_WORKING_DIRECTORY,
  };
}

export function buildGitRemoteResourceBindings(
  binding: ResolvedWorkspaceStorageBinding,
): Record<string, unknown>[] {
  if (binding.type !== 'git_remote' || !binding.repository_url || !binding.git_token_secret_ref) {
    return [];
  }
  return [
    {
      type: 'git_repository',
      repository_url: binding.repository_url,
      credentials: {
        token: binding.git_token_secret_ref,
      },
    },
  ];
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
