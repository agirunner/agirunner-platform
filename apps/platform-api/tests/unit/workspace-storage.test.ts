import { describe, expect, it } from 'vitest';

import {
  buildGitRemoteResourceBindings,
  resolveWorkspaceStorageBinding,
} from '../../src/services/workspace-storage.js';

describe('workspace storage binding', () => {
  it('resolves git remote bindings from typed workspace settings', () => {
    expect(
      resolveWorkspaceStorageBinding({
        settings: {
          workspace_storage_type: 'git_remote',
          workspace_storage: {
            repository_url: 'https://github.com/example/repo.git',
            default_branch: 'main',
            git_user_name: 'Agent Dev',
            git_user_email: 'agent@example.com',
          },
          credentials: {
            git_token: 'secret:GIT_TOKEN',
          },
        },
      }),
    ).toEqual({
      type: 'git_remote',
      working_directory: '/workspace/repo',
      repository_url: 'https://github.com/example/repo.git',
      default_branch: 'main',
      git_user_name: 'Agent Dev',
      git_user_email: 'agent@example.com',
      git_token_secret_ref: 'secret:GIT_TOKEN',
    });
  });

  it('falls back to the workspace repository column for legacy git workspaces', () => {
    expect(
      resolveWorkspaceStorageBinding({
        repository_url: 'https://github.com/example/repo.git',
        settings: {
          default_branch: 'release',
          git_user_name: 'Legacy Bot',
          git_user_email: 'legacy@example.com',
          credentials: {
            git_token: 'secret:GIT_TOKEN',
          },
        },
      }),
    ).toEqual({
      type: 'git_remote',
      working_directory: '/workspace/repo',
      repository_url: 'https://github.com/example/repo.git',
      default_branch: 'release',
      git_user_name: 'Legacy Bot',
      git_user_email: 'legacy@example.com',
      git_token_secret_ref: 'secret:GIT_TOKEN',
    });
  });

  it('resolves host directory bindings', () => {
    expect(
      resolveWorkspaceStorageBinding({
        settings: {
          workspace_storage_type: 'host_directory',
          workspace_storage: {
            host_path: '/home/mark/coolrepo',
            read_only: true,
          },
        },
      }),
    ).toEqual({
      type: 'host_directory',
      working_directory: '/workspace/repo',
      host_path: '/home/mark/coolrepo',
      read_only: true,
    });
  });

  it('defaults to workspace artifacts when no explicit storage is configured', () => {
    expect(resolveWorkspaceStorageBinding({ settings: {} })).toEqual({
      type: 'workspace_artifacts',
      working_directory: '/workspace/repo',
    });
  });

  it('builds a git repository resource binding only for git remote workspaces', () => {
    expect(
      buildGitRemoteResourceBindings({
        type: 'git_remote',
        working_directory: '/workspace/repo',
        repository_url: 'https://github.com/example/repo.git',
        default_branch: null,
        git_user_name: null,
        git_user_email: null,
        git_token_secret_ref: 'secret:GIT_TOKEN',
      }),
    ).toEqual([
      {
        type: 'git_repository',
        repository_url: 'https://github.com/example/repo.git',
        credentials: {
          token: 'secret:GIT_TOKEN',
        },
      },
    ]);

    expect(
      buildGitRemoteResourceBindings({
        type: 'workspace_artifacts',
        working_directory: '/workspace/repo',
      }),
    ).toEqual([]);
  });
});
