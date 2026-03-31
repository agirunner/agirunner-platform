import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  normalizeWorkspaceSettings,
  readWorkspaceStorageSettings,
  readWorkspaceSettingsExtras,
  readWorkspaceRepositorySettings,
  validateWorkspaceSettingsShape,
} from '../../../src/services/workspace/workspace-settings.js';

describe('workspace settings', () => {
  const hostPath = resolve('fixtures/coolrepo');

  it('normalizes legacy top-level git settings into the canonical credentials shape', () => {
    const normalized = normalizeWorkspaceSettings({
      default_branch: 'develop',
      git_user_name: 'Jane Example',
      git_user_email: 'jane@example.com',
      git_token_secret_ref: 'secret:GIT_TOKEN',
    });

    expect(normalized).toEqual({
      default_branch: 'develop',
      git_user_name: 'Jane Example',
      git_user_email: 'jane@example.com',
      credentials: {
        git_token: 'secret:GIT_TOKEN',
      },
    });
  });

  it('reads repository settings from canonical settings', () => {
    expect(
      readWorkspaceRepositorySettings({
        workspace_storage_type: 'git_remote',
        workspace_storage: {
          repository_url: 'https://github.com/example/repo.git',
          default_branch: 'main',
          git_user_name: 'Jane Example',
          git_user_email: 'jane@example.com',
        },
        credentials: {
          git_token: 'secret:GIT_TOKEN',
        },
      }),
    ).toEqual({
      defaultBranch: 'main',
      gitUserName: 'Jane Example',
      gitUserEmail: 'jane@example.com',
      gitTokenSecretRef: 'secret:GIT_TOKEN',
    });
  });

  it('normalizes host directory storage settings', () => {
    expect(
      normalizeWorkspaceSettings({
        workspace_storage_type: 'host_directory',
        workspace_storage: {
          host_path: hostPath,
        },
      }),
    ).toEqual({
      workspace_storage_type: 'host_directory',
      workspace_storage: {
        host_path: hostPath,
      },
      credentials: {},
    });
  });

  it('reads typed workspace storage settings', () => {
    expect(
      readWorkspaceStorageSettings({
        workspace_storage_type: 'host_directory',
        workspace_storage: {
          host_path: hostPath,
          read_only: true,
        },
      }),
    ).toEqual({
      type: 'host_directory',
      repositoryUrl: null,
      defaultBranch: null,
      gitUserName: null,
      gitUserEmail: null,
      hostPath: hostPath,
      readOnly: true,
      gitTokenSecretRef: null,
    });
  });

  it('separates typed workspace settings from extra config payloads', () => {
    expect(
      readWorkspaceSettingsExtras({
        workspace_storage_type: 'workspace_artifacts',
        workspace_storage: {},
        default_branch: 'main',
        git_user_name: 'Smoke Bot',
        workspace_brief: 'Ship it',
        config: {
          runtime: {
            timeout: 45,
          },
        },
        delivery: {
          board: 'default',
        },
      }),
    ).toEqual({
      config: {
        runtime: {
          timeout: 45,
        },
      },
      delivery: {
        board: 'default',
      },
    });
  });

  it('rejects the legacy singular model override field', () => {
    expect(() =>
      validateWorkspaceSettingsShape({
        model_override: {
          model_id: '00000000-0000-0000-0000-000000000020',
        },
      }),
    ).toThrow(/model_override.*no longer supported/i);
  });

  it('strips stored legacy model overrides from normalized workspace settings', () => {
    expect(
      normalizeWorkspaceSettings({
        model_overrides: {
          architect: {
            provider: '',
            model: 'gpt-5.4',
          },
        },
      }),
    ).toEqual({
      credentials: {},
    });
  });

  it('rejects the retired plural model overrides field on input parsing', () => {
    expect(() =>
      validateWorkspaceSettingsShape({
        model_overrides: {
          architect: {
            provider: 'openai',
            model: 'gpt-5.4',
          },
        },
      }),
    ).toThrow(/model_overrides.*no longer supported/i);
  });

  it('rejects relative host directory paths', () => {
    expect(() =>
      validateWorkspaceSettingsShape({
        workspace_storage_type: 'host_directory',
        workspace_storage: {
          host_path: './relative/path',
        },
      }),
    ).toThrow(/absolute path/i);
  });
});
