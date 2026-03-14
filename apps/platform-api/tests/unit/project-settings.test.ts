import { describe, expect, it } from 'vitest';

import {
  normalizeProjectSettings,
  readProjectRepositorySettings,
  validateProjectSettingsShape,
} from '../../src/services/project-settings.js';

describe('project settings', () => {
  it('normalizes legacy top-level git settings into the canonical credentials shape', () => {
    const normalized = normalizeProjectSettings({
      default_branch: 'develop',
      git_user_name: 'Jane Example',
      git_user_email: 'jane@example.com',
      git_token_secret_ref: 'secret:GIT_TOKEN',
      model_overrides: {
        architect: {
          provider: 'openai',
          model: 'gpt-5.4',
        },
      },
    });

    expect(normalized).toEqual({
      default_branch: 'develop',
      git_user_name: 'Jane Example',
      git_user_email: 'jane@example.com',
      credentials: {
        git_token: 'secret:GIT_TOKEN',
      },
      model_overrides: {
        architect: {
          provider: 'openai',
          model: 'gpt-5.4',
        },
      },
    });
  });

  it('reads repository settings from canonical settings', () => {
    expect(
      readProjectRepositorySettings({
        default_branch: 'main',
        git_user_name: 'Jane Example',
        git_user_email: 'jane@example.com',
        credentials: {
          git_token: 'secret:GIT_TOKEN',
          git_ssh_private_key: 'secret:GIT_SSH',
          git_ssh_known_hosts: 'github.com ssh-ed25519 AAAA',
        },
      }),
    ).toEqual({
      defaultBranch: 'main',
      gitUserName: 'Jane Example',
      gitUserEmail: 'jane@example.com',
      gitTokenSecretRef: 'secret:GIT_TOKEN',
      gitSshPrivateKeyRef: 'secret:GIT_SSH',
      gitSshKnownHosts: 'github.com ssh-ed25519 AAAA',
      webhookSecretRef: null,
    });
  });

  it('rejects the legacy singular project model override field', () => {
    expect(() =>
      validateProjectSettingsShape({
        model_override: {
          model_id: '00000000-0000-0000-0000-000000000020',
        },
      }),
    ).toThrow(/model_override.*retired/i);
  });

  it('rejects malformed role model overrides', () => {
    expect(() =>
      validateProjectSettingsShape({
        model_overrides: {
          architect: {
            provider: '',
            model: 'gpt-5.4',
          },
        },
      }),
    ).toThrow(/model_overrides/i);
  });
});
