import { describe, expect, it, vi } from 'vitest';

import { WorkspaceService } from '../../src/services/workspace-service.js';

const TENANT_ID = 'tenant-1';
const WORKSPACE_ID = 'workspace-1';

const workspaceRow = {
  id: WORKSPACE_ID,
  tenant_id: TENANT_ID,
  name: 'Demo',
  slug: 'demo',
  description: null,
  repository_url: 'https://github.com/example/demo',
  settings: {
    deployment: {
      api_token: 'plain-secret-token',
      endpoint: 'https://example.com',
      ref: 'secret:DEPLOY_TOKEN',
    },
  },
  memory: {
    SAFE_LABEL: 'demo',
    apiKey: 'plain-memory-key',
    nested: {
      authorization: 'Bearer top-secret',
      preserved_ref: 'secret:RUNTIME_API_KEY',
    },
  },
  git_webhook_provider: 'github',
  git_webhook_secret: 'enc:v1:encrypted',
  is_active: true,
  created_at: new Date('2026-03-12T00:00:00.000Z'),
  updated_at: new Date('2026-03-12T00:00:00.000Z'),
};

function createEventService() {
  return { emit: vi.fn(async () => undefined) };
}

describe('WorkspaceService secret redaction', () => {
  it('redacts secret-bearing settings and memory on single-workspace reads', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rowCount: 1,
        rows: [workspaceRow],
      }),
    };

    const service = new WorkspaceService(pool as never, createEventService() as never);

    const result = await service.getWorkspace(TENANT_ID, WORKSPACE_ID);

    expect(result).not.toHaveProperty('git_webhook_secret');
    expect(result.git_webhook_secret_configured).toBe(true);
    expect(result.settings).toEqual(
      expect.objectContaining({
        credentials: {
          git_token: null,
          git_token_configured: false,
        },
        deployment: {
          api_token: 'redacted://workspace-settings-secret',
          endpoint: 'https://example.com',
          ref: 'redacted://workspace-settings-secret',
        },
      }),
    );
    expect(result.memory).toEqual({
      SAFE_LABEL: 'demo',
      apiKey: 'redacted://workspace-memory-secret',
      nested: {
        authorization: 'redacted://workspace-memory-secret',
        preserved_ref: 'redacted://workspace-memory-secret',
      },
    });
  });

  it('redacts secret-bearing settings and memory on workspace list reads', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [workspaceRow] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }),
    };

    const service = new WorkspaceService(pool as never, createEventService() as never);

    const result = await service.listWorkspaces(TENANT_ID, {
      page: 1,
      per_page: 20,
    });
    const listedWorkspace = result.data[0] as Record<string, unknown>;

    expect(result.data).toHaveLength(1);
    expect(listedWorkspace).not.toHaveProperty('git_webhook_secret');
    expect(listedWorkspace.git_webhook_secret_configured).toBe(true);
    expect(listedWorkspace.settings).toEqual(
      expect.objectContaining({
        credentials: {
          git_token: null,
          git_token_configured: false,
        },
        deployment: {
          api_token: 'redacted://workspace-settings-secret',
          endpoint: 'https://example.com',
          ref: 'redacted://workspace-settings-secret',
        },
      }),
    );
    expect(listedWorkspace.memory).toEqual({
      SAFE_LABEL: 'demo',
      apiKey: 'redacted://workspace-memory-secret',
      nested: {
        authorization: 'redacted://workspace-memory-secret',
        preserved_ref: 'redacted://workspace-memory-secret',
      },
    });
  });

  it('migrates legacy plaintext git webhook secrets during workspace reads', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ ...workspaceRow, git_webhook_secret: 'legacy-git-secret' }],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    const service = new WorkspaceService(
      pool as never,
      createEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: '12345678901234567890123456789012' },
    );

    const result = await service.getWorkspace(TENANT_ID, WORKSPACE_ID);

    expect(result.git_webhook_secret_configured).toBe(true);
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE workspaces'),
      [TENANT_ID, WORKSPACE_ID, expect.stringMatching(/^enc:v\d+:/)],
    );
  });

  it('redacts secret-like settings and memory values even when the field name is not secret-like', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          ...workspaceRow,
          settings: {
            endpoint: {
              auth: 'Bearer top-secret',
              session: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
            },
          },
          memory: {
            summary: 'Bearer operator-secret',
            session: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
          },
        }],
      }),
    };

    const service = new WorkspaceService(pool as never, createEventService() as never);

    const result = await service.getWorkspace(TENANT_ID, WORKSPACE_ID);

    expect(result.settings).toEqual(
      expect.objectContaining({
        credentials: {
          git_token: null,
          git_token_configured: false,
        },
        endpoint: {
          auth: 'redacted://workspace-settings-secret',
          session: 'redacted://workspace-settings-secret',
        },
      }),
    );
    expect(result.memory).toEqual({
      summary: 'redacted://workspace-memory-secret',
      session: 'redacted://workspace-memory-secret',
    });
  });
});
