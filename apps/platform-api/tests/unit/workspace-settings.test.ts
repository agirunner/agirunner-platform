import { describe, expect, it } from 'vitest';

import {
  normalizeWorkspaceSettings,
  readWorkspaceSettingsExtras,
  readWorkspaceRepositorySettings,
  validateWorkspaceSettingsShape,
} from '../../src/services/workspace-settings.js';

describe('project settings', () => {
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
      model_overrides: {},
    });
  });

  it('reads repository settings from canonical settings', () => {
    expect(
      readWorkspaceRepositorySettings({
        default_branch: 'main',
        git_user_name: 'Jane Example',
        git_user_email: 'jane@example.com',
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

  it('separates typed workspace settings from extra config payloads', () => {
    expect(
      readWorkspaceSettingsExtras({
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

  it('rejects the legacy singular project model override field', () => {
    expect(() =>
      validateWorkspaceSettingsShape({
        model_override: {
          model_id: '00000000-0000-0000-0000-000000000020',
        },
      }),
    ).toThrow(/model_override.*no longer supported/i);
  });

  it('drops project model overrides from normalized project settings', () => {
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
      model_overrides: {},
    });
  });
});
