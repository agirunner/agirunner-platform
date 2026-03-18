import { describe, expect, it, vi } from 'vitest';

import {
  configureProviderSecretEncryptionKey,
  readProviderSecret,
  storeProviderSecret,
} from '../../src/lib/oauth-crypto.js';
import { WorkspaceService } from '../../src/services/workspace-service.js';

configureProviderSecretEncryptionKey('test-encryption-key');

function createIdentity() {
  return {
    tenantId: 'tenant-1',
    scope: 'admin',
    ownerType: 'tenant',
    ownerId: 'tenant-1',
    keyPrefix: 'admin-key',
    id: 'key-1',
  };
}

function createEventService() {
  return { emit: vi.fn(async () => undefined) };
}

describe('WorkspaceService typed settings contract', () => {
  it('stores canonical typed settings on workspace create and redacts secrets in the response', async () => {
    let insertedSettings: Record<string, unknown> | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
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
      }),
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
        model_overrides: {
          developer: {
            provider: 'openai',
            model: 'gpt-5',
          },
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
      model_overrides: {},
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
      model_overrides: {},
      workspace_brief: 'Ship it',
    });
  });

  it('preserves stored secrets when workspace updates echo redacted credential posture', async () => {
    let updatedSettings: Record<string, unknown> | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
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
      }),
    };

    const service = new WorkspaceService(pool as never, createEventService() as never);

    const result = await service.updateWorkspace(createIdentity() as never, 'workspace-1', {
      settings: {
        default_branch: 'release',
        credentials: {
          git_token: 'redacted://workspace-settings-secret',
          git_token_configured: true,
        },
        model_overrides: {
          reviewer: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
          },
        },
      },
    });

    expect(updatedSettings).toEqual({
      default_branch: 'release',
      credentials: {
        git_token: 'secret:GITHUB_PAT',
      },
      model_overrides: {},
    });
    expect(result.settings).toEqual({
      default_branch: 'release',
      credentials: {
        git_token: 'redacted://workspace-settings-secret',
        git_token_configured: true,
      },
      model_overrides: {},
    });
  });

  it('encrypts raw git tokens before persisting workspace settings', async () => {
    let insertedSettings: Record<string, unknown> | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
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
      }),
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
      model_overrides: {},
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
      model_overrides: {},
    });
  });

  it('migrates legacy plaintext git tokens during workspace reads', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
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
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [],
        }),
    };

    const service = new WorkspaceService(
      pool as never,
      createEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: 'test-encryption-key' },
    );

    const result = await service.getWorkspace('tenant-1', 'workspace-legacy-token');

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE workspaces'),
      [
        'tenant-1',
        'workspace-legacy-token',
        expect.objectContaining({
          credentials: {
            git_token: expect.stringMatching(/^enc:v1:/),
          },
          model_overrides: {},
        }),
      ],
    );
    expect(result.settings).toEqual({
      credentials: {
        git_token: 'redacted://workspace-settings-secret',
        git_token_configured: true,
      },
      model_overrides: {},
    });
  });

  it('scrubs legacy git_token_secret_ref when canonical credentials are already stored', async () => {
    const encryptedCanonicalToken = storeProviderSecret('ghp_canonical_workspace_token');
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
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
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [],
        }),
    };

    const service = new WorkspaceService(
      pool as never,
      createEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: 'test-encryption-key' },
    );

    const result = await service.getWorkspace('tenant-1', 'workspace-mixed-token');

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE workspaces'),
      [
        'tenant-1',
        'workspace-mixed-token',
        {
          credentials: {
            git_token: encryptedCanonicalToken,
          },
          model_overrides: {},
        },
      ],
    );
    expect(result.settings).toEqual({
      credentials: {
        git_token: 'redacted://workspace-settings-secret',
        git_token_configured: true,
      },
      model_overrides: {},
    });
  });
});

describe('WorkspaceService workspace list summaries', () => {
  it('returns workflow summary counts with a single aggregate query for the page', async () => {
    const workflowSummaryQueries: Array<unknown[] | undefined> = [];
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('SELECT COUNT(*)::int AS total FROM workspaces')) {
          return {
            rowCount: 1,
            rows: [{ total: 2 }],
          };
        }

        if (sql.startsWith('SELECT * FROM workspaces')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: '11111111-1111-1111-1111-111111111111',
                tenant_id: 'tenant-1',
                name: 'Alpha',
                slug: 'alpha',
                description: null,
                repository_url: null,
                settings: {},
                memory: {},
                git_webhook_secret: null,
                is_active: true,
              },
              {
                id: '22222222-2222-2222-2222-222222222222',
                tenant_id: 'tenant-1',
                name: 'Beta',
                slug: 'beta',
                description: null,
                repository_url: null,
                settings: {},
                memory: {},
                git_webhook_secret: null,
                is_active: true,
              },
            ],
          };
        }

        if (sql.includes('FROM workflows') && sql.includes('GROUP BY workspace_id')) {
          workflowSummaryQueries.push(values);
          return {
            rowCount: 1,
            rows: [
              {
                workspace_id: '11111111-1111-1111-1111-111111111111',
                active_workflow_count: 1,
                completed_workflow_count: 4,
                attention_workflow_count: 2,
                total_workflow_count: 7,
                last_workflow_activity_at: '2026-03-14T10:15:00.000Z',
              },
            ],
          };
        }

        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkspaceService(pool as never, createEventService() as never);

    const result = await service.listWorkspaces('tenant-1', {
      page: 1,
      per_page: 50,
    });

    expect(workflowSummaryQueries).toEqual([
      [
        'tenant-1',
        [
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
        ],
      ],
    ]);
    expect(result.data).toEqual([
      expect.objectContaining({
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Alpha',
        summary: {
          active_workflow_count: 1,
          completed_workflow_count: 4,
          attention_workflow_count: 2,
          total_workflow_count: 7,
          last_workflow_activity_at: '2026-03-14T10:15:00.000Z',
        },
      }),
      expect.objectContaining({
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Beta',
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 0,
          attention_workflow_count: 0,
          total_workflow_count: 0,
          last_workflow_activity_at: null,
        },
      }),
    ]);
    expect(result.meta).toEqual({
      total: 2,
      page: 1,
      per_page: 50,
      pages: 1,
    });
  });
});
