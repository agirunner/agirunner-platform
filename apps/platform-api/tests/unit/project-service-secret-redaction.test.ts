import { describe, expect, it, vi } from 'vitest';

import { ProjectService } from '../../src/services/project-service.js';

const TENANT_ID = 'tenant-1';
const PROJECT_ID = 'project-1';

const projectRow = {
  id: PROJECT_ID,
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

describe('ProjectService secret redaction', () => {
  it('redacts secret-bearing settings and memory on single-project reads', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rowCount: 1,
        rows: [projectRow],
      }),
    };

    const service = new ProjectService(pool as never, createEventService() as never);

    const result = await service.getProject(TENANT_ID, PROJECT_ID);

    expect(result).not.toHaveProperty('git_webhook_secret');
    expect(result.git_webhook_secret_configured).toBe(true);
    expect(result.settings).toEqual({
      deployment: {
        api_token: 'redacted://project-settings-secret',
        endpoint: 'https://example.com',
        ref: 'secret:DEPLOY_TOKEN',
      },
    });
    expect(result.memory).toEqual({
      SAFE_LABEL: 'demo',
      apiKey: 'redacted://project-memory-secret',
      nested: {
        authorization: 'redacted://project-memory-secret',
        preserved_ref: 'secret:RUNTIME_API_KEY',
      },
    });
  });

  it('redacts secret-bearing settings and memory on project list reads', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [projectRow] }),
    };

    const service = new ProjectService(pool as never, createEventService() as never);

    const result = await service.listProjects(TENANT_ID, {
      page: 1,
      per_page: 20,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).not.toHaveProperty('git_webhook_secret');
    expect(result.data[0]?.git_webhook_secret_configured).toBe(true);
    expect(result.data[0]?.settings).toEqual({
      deployment: {
        api_token: 'redacted://project-settings-secret',
        endpoint: 'https://example.com',
        ref: 'secret:DEPLOY_TOKEN',
      },
    });
    expect(result.data[0]?.memory).toEqual({
      SAFE_LABEL: 'demo',
      apiKey: 'redacted://project-memory-secret',
      nested: {
        authorization: 'redacted://project-memory-secret',
        preserved_ref: 'secret:RUNTIME_API_KEY',
      },
    });
  });

  it('migrates legacy plaintext git webhook secrets during project reads', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ ...projectRow, git_webhook_secret: 'legacy-git-secret' }],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    const service = new ProjectService(
      pool as never,
      createEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: '12345678901234567890123456789012' },
    );

    const result = await service.getProject(TENANT_ID, PROJECT_ID);

    expect(result.git_webhook_secret_configured).toBe(true);
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE projects'),
      [TENANT_ID, PROJECT_ID, expect.stringMatching(/^enc:v\d+:/)],
    );
  });
});
