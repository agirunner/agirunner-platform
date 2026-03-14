import { describe, expect, it, vi } from 'vitest';

import { ProjectService } from '../../src/services/project-service.js';

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

describe('ProjectService typed settings contract', () => {
  it('stores canonical typed settings on project create and redacts secrets in the response', async () => {
    let insertedSettings: Record<string, unknown> | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('INSERT INTO projects')) {
          insertedSettings = (values?.[5] as Record<string, unknown>) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'project-1',
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

    const service = new ProjectService(pool as never, createEventService() as never);

    const result = await service.createProject(createIdentity() as never, {
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
        project_brief: 'Ship it',
      },
    });

    expect(insertedSettings).toEqual({
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
      project_brief: 'Ship it',
    });
    expect(result.settings).toEqual({
      default_branch: 'main',
      git_user_name: 'Smoke Bot',
      git_user_email: 'smoke@example.test',
      credentials: {
        git_token: 'redacted://project-settings-secret',
        git_token_configured: true,
        git_ssh_private_key: null,
        git_ssh_private_key_configured: false,
        git_ssh_known_hosts: null,
        git_ssh_known_hosts_configured: false,
        webhook_secret: null,
        webhook_secret_configured: false,
      },
      model_overrides: {
        developer: {
          provider: 'openai',
          model: 'gpt-5',
        },
      },
      project_brief: 'Ship it',
    });
  });

  it('preserves stored secrets when project updates echo redacted credential posture', async () => {
    let updatedSettings: Record<string, unknown> | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('SELECT *') && sql.includes('FROM projects')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'project-1',
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
        if (sql.startsWith('UPDATE projects')) {
          updatedSettings = (values?.[6] as Record<string, unknown>) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'project-1',
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

    const service = new ProjectService(pool as never, createEventService() as never);

    const result = await service.updateProject(createIdentity() as never, 'project-1', {
      settings: {
        default_branch: 'release',
        credentials: {
          git_token: 'redacted://project-settings-secret',
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
      model_overrides: {
        reviewer: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
        },
      },
    });
    expect(result.settings).toEqual({
      default_branch: 'release',
      credentials: {
        git_token: 'redacted://project-settings-secret',
        git_token_configured: true,
        git_ssh_private_key: null,
        git_ssh_private_key_configured: false,
        git_ssh_known_hosts: null,
        git_ssh_known_hosts_configured: false,
        webhook_secret: null,
        webhook_secret_configured: false,
      },
      model_overrides: {
        reviewer: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
        },
      },
    });
  });
});
