import { describe, expect, it } from 'vitest';

import {
  readProviderSecret,
  storeProviderSecret,
} from '../../../src/lib/oauth-crypto.js';
import { WorkspaceService } from '../../../src/services/workspace-service.js';
import {
  createEventService,
  createIdentity,
} from './workspace-test-helpers.js';

describe('WorkspaceService typed settings contract', () => {
  it('stores canonical typed settings on workspace create and redacts secrets in the response', async () => {
    let insertedSettings: Record<string, unknown> | null = null;
    const pool = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('INSERT INTO workspaces')) {
          insertedSettings = (values?.[5] as Record<string, unknown>) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'workspace-1',
              tenant_id: 'tenant-1',
              name: 'Demo',
              slug: 'demo',
              description: null,
              repository_url: 'https://github.com/example/demo',
              settings: insertedSettings,
              memory: {},
              git_webhook_secret: null,
              is_active: true,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    };

    const service = new WorkspaceService(pool as never, createEventService() as never);

    const result = await service.createWorkspace(createIdentity() as never, {
      name: 'Demo',
      slug: 'demo',
      repository_url: 'https://github.com/example/demo',
      settings: {
        default_branch: 'main',
        git_user_name: 'Smoke Bot',
        git_user_email: 'smoke@example.test',
        credentials: {
          git_token: 'secret:GITHUB_PAT',
        },
        workspace_brief: 'Ship it',
      },
    });

    expect(insertedSettings).toEqual({
      default_branch: 'main',
      git_user_name: 'Smoke Bot',
      git_user_email: 'smoke@example.test',
      credentials: {
        git_token: 'secret:GITHUB_PAT',
      },
      workspace_brief: 'Ship it',
    });
    expect(result.settings).toEqual({
      default_branch: 'main',
      git_user_name: 'Smoke Bot',
      git_user_email: 'smoke@example.test',
      credentials: {
        git_token: 'redacted://workspace-settings-secret',
        git_token_configured: true,
      },
      workspace_brief: 'Ship it',
    });
  });

  it('preserves stored secrets when workspace updates echo redacted credential posture', async () => {
    let updatedSettings: Record<string, unknown> | null = null;
    const pool = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('SELECT *') && sql.includes('FROM workspaces')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workspace-1',
              tenant_id: 'tenant-1',
              name: 'Demo',
              slug: 'demo',
              description: null,
              repository_url: 'https://github.com/example/demo',
              settings: {
                default_branch: 'main',
                credentials: {
                  git_token: 'secret:GITHUB_PAT',
                },
              },
              memory: {},
              git_webhook_secret: null,
              is_active: true,
            }],
          };
        }
        if (sql.startsWith('UPDATE workspaces')) {
          updatedSettings = (values?.[6] as Record<string, unknown>) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'workspace-1',
              tenant_id: 'tenant-1',
              name: 'Demo',
              slug: 'demo',
              description: null,
              repository_url: 'https://github.com/example/demo',
              settings: updatedSettings,
              memory: {},
              git_webhook_secret: null,
              is_active: true,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    };

    const service = new WorkspaceService(pool as never, createEventService() as never);

    const result = await service.updateWorkspace(createIdentity() as never, 'workspace-1', {
      settings: {
        default_branch: 'release',
        credentials: {
          git_token: 'redacted://workspace-settings-secret',
          git_token_configured: true,
        },
      },
    });

    expect(updatedSettings).toEqual({
      default_branch: 'release',
      credentials: {
        git_token: 'secret:GITHUB_PAT',
      },
    });
    expect(result.settings).toEqual({
      default_branch: 'release',
      credentials: {
        git_token: 'redacted://workspace-settings-secret',
        git_token_configured: true,
      },
    });
  });

  it('encrypts raw git tokens before persisting workspace settings', async () => {
    let insertedSettings: Record<string, unknown> | null = null;
    const pool = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('INSERT INTO workspaces')) {
          insertedSettings = (values?.[5] as Record<string, unknown>) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'workspace-raw-token',
              tenant_id: 'tenant-1',
              name: 'Demo',
              slug: 'demo',
              description: null,
              repository_url: 'https://github.com/example/demo',
              settings: insertedSettings,
              memory: {},
              git_webhook_secret: null,
              is_active: true,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    };

    const service = new WorkspaceService(pool as never, createEventService() as never);

    const result = await service.createWorkspace(createIdentity() as never, {
      name: 'Demo',
      slug: 'demo',
      repository_url: 'https://github.com/example/demo',
      settings: {
        credentials: {
          git_token: 'ghp_live_workspace_token',
        },
      },
    });

    expect(insertedSettings).toEqual({
      credentials: {
        git_token: expect.stringMatching(/^enc:v1:/),
      },
    });
    if (!insertedSettings) {
      throw new Error('expected inserted settings to be captured');
    }
    const insertedSettingsRecord: Record<string, unknown> = insertedSettings;
    const insertedCredentials = (insertedSettingsRecord.credentials ?? {}) as Record<string, unknown>;
    expect(
      readProviderSecret(String(insertedCredentials.git_token ?? '')),
    ).toBe('ghp_live_workspace_token');
    expect(result.settings).toEqual({
      credentials: {
        git_token: 'redacted://workspace-settings-secret',
        git_token_configured: true,
      },
    });
  });

  it('migrates legacy plaintext git tokens during workspace reads', async () => {
    const pool = {
      query: async () => ({
        rowCount: 1,
        rows: [{
          id: 'workspace-legacy-token',
          tenant_id: 'tenant-1',
          name: 'Demo',
          slug: 'demo',
          description: null,
          repository_url: 'https://github.com/example/demo',
          settings: {
            credentials: {
              git_token: 'ghp_legacy_workspace_token',
            },
          },
          memory: {},
          git_webhook_secret: null,
          is_active: true,
        }],
      }),
    };

    const service = new WorkspaceService(
      pool as never,
      createEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: 'test-encryption-key' },
    );

    const result = await service.getWorkspace('tenant-1', 'workspace-legacy-token');

    expect(result.settings).toEqual({
      credentials: {
        git_token: 'redacted://workspace-settings-secret',
        git_token_configured: true,
      },
    });
  });

  it('scrubs legacy git_token_secret_ref when canonical credentials are already stored', async () => {
    const encryptedCanonicalToken = storeProviderSecret('ghp_canonical_workspace_token');
    let updatedSettings: Record<string, unknown> | null = null;
    const pool = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('SELECT *') && sql.includes('FROM workspaces')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workspace-mixed-token',
              tenant_id: 'tenant-1',
              name: 'Demo',
              slug: 'demo',
              description: null,
              repository_url: 'https://github.com/example/demo',
              settings: {
                credentials: {
                  git_token: encryptedCanonicalToken,
                },
                git_token_secret_ref: 'ghp_legacy_plaintext_token',
              },
              memory: {},
              git_webhook_secret: null,
              is_active: true,
            }],
          };
        }
        if (sql.startsWith('UPDATE workspaces')) {
          updatedSettings = values?.[2] as Record<string, unknown>;
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    };

    const service = new WorkspaceService(
      pool as never,
      createEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: 'test-encryption-key' },
    );

    const result = await service.getWorkspace('tenant-1', 'workspace-mixed-token');

    expect(updatedSettings).toEqual({
      credentials: {
        git_token: encryptedCanonicalToken,
      },
    });
    expect(result.settings).toEqual({
      credentials: {
        git_token: 'redacted://workspace-settings-secret',
        git_token_configured: true,
      },
    });
  });
});
