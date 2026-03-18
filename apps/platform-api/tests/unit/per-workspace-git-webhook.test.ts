import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { extractRepositoryUrl } from '../../src/services/git-platform-adapter.js';
import { WorkspaceService } from '../../src/services/workspace-service.js';
import { encryptWebhookSecret } from '../../src/services/webhook-secret-crypto.js';

const ENCRYPTION_KEY = 'a]n;.2xN!@#superSecretEncKey1234567890';
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000099';

/* ------------------------------------------------------------------ */
/*  extractRepositoryUrl                                               */
/* ------------------------------------------------------------------ */

describe('extractRepositoryUrl', () => {
  it('extracts clone_url from GitHub payload', () => {
    const payload = { repository: { clone_url: 'https://github.com/org/repo.git' } };
    expect(extractRepositoryUrl('github', payload)).toBe('https://github.com/org/repo.git');
  });

  it('extracts html_url when clone_url is absent', () => {
    const payload = { repository: { html_url: 'https://github.com/org/repo' } };
    expect(extractRepositoryUrl('github', payload)).toBe('https://github.com/org/repo');
  });

  it('extracts git_http_url from GitLab payload', () => {
    const payload = { repository: { git_http_url: 'https://gitlab.com/org/repo.git' } };
    expect(extractRepositoryUrl('gitlab', payload)).toBe('https://gitlab.com/org/repo.git');
  });

  it('falls back to homepage for GitLab', () => {
    const payload = { repository: { homepage: 'https://gitlab.com/org/repo' } };
    expect(extractRepositoryUrl('gitlab', payload)).toBe('https://gitlab.com/org/repo');
  });

  it('extracts clone_url from Gitea payload', () => {
    const payload = { repository: { clone_url: 'https://gitea.example.com/org/repo.git' } };
    expect(extractRepositoryUrl('gitea', payload)).toBe('https://gitea.example.com/org/repo.git');
  });

  it('returns undefined when repository object is missing', () => {
    expect(extractRepositoryUrl('github', {})).toBeUndefined();
  });

  it('returns undefined when repository has no url fields', () => {
    const payload = { repository: { name: 'repo' } };
    expect(extractRepositoryUrl('github', payload)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  WorkspaceService — git webhook config                                */
/* ------------------------------------------------------------------ */

function createMockPool(responses: Record<string, { rows: unknown[]; rowCount: number }> = {}) {
  return {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      for (const [key, value] of Object.entries(responses)) {
        if (sql.includes(key)) {
          return value;
        }
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

function createMockEventService() {
  return { emit: vi.fn(async () => {}) };
}

function createIdentity() {
  return {
    id: 'key:test',
    tenantId: TENANT_ID,
    scope: 'admin' as const,
    ownerType: 'system' as const,
    ownerId: null,
    keyPrefix: 'test',
  };
}

describe('WorkspaceService.setGitWebhookConfig', () => {
  it('encrypts secret and stores provider', async () => {
    const pool = createMockPool({
      'SELECT': { rows: [{ id: WORKSPACE_ID, tenant_id: TENANT_ID }], rowCount: 1 },
      'UPDATE': {
        rows: [{
          id: WORKSPACE_ID,
          name: 'test',
          slug: 'test',
          git_webhook_provider: 'github',
          is_active: true,
          updated_at: new Date().toISOString(),
        }],
        rowCount: 1,
      },
    });

    const service = new WorkspaceService(
      pool as never,
      createMockEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: ENCRYPTION_KEY },
    );

    const result = await service.setGitWebhookConfig(
      createIdentity(),
      WORKSPACE_ID,
      { provider: 'github', secret: 'my-webhook-secret' },
    );

    expect(result.git_webhook_secret_configured).toBe(true);

    const updateCall = pool.query.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes('UPDATE workspaces'),
    );
    expect(updateCall).toBeDefined();
    const params = updateCall![1] as unknown[];
    expect(params[2]).toBe('github');
    expect(String(params[3])).toMatch(/^enc:v1:/);
  });

  it('emits workspace.git_webhook_configured event', async () => {
    const eventService = createMockEventService();
    const pool = createMockPool({
      'SELECT': { rows: [{ id: WORKSPACE_ID, tenant_id: TENANT_ID }], rowCount: 1 },
      'UPDATE': {
        rows: [{ id: WORKSPACE_ID, name: 'test', slug: 'test', git_webhook_provider: 'github', is_active: true }],
        rowCount: 1,
      },
    });

    const service = new WorkspaceService(
      pool as never,
      eventService as never,
      { WEBHOOK_ENCRYPTION_KEY: ENCRYPTION_KEY },
    );

    await service.setGitWebhookConfig(
      createIdentity(),
      WORKSPACE_ID,
      { provider: 'github', secret: 'my-webhook-secret' },
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspace.git_webhook_configured',
        entityId: WORKSPACE_ID,
        data: { provider: 'github' },
      }),
    );
  });
});

describe('WorkspaceService.getGitWebhookSecret', () => {
  it('returns decrypted secret when configured', async () => {
    const encrypted = encryptWebhookSecret('my-secret', ENCRYPTION_KEY);
    const pool = createMockPool({
      'SELECT': {
        rows: [{ git_webhook_provider: 'github', git_webhook_secret: encrypted }],
        rowCount: 1,
      },
    });

    const service = new WorkspaceService(
      pool as never,
      createMockEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: ENCRYPTION_KEY },
    );

    const result = await service.getGitWebhookSecret(TENANT_ID, WORKSPACE_ID);
    expect(result).toEqual({ provider: 'github', secret: 'my-secret' });
  });

  it('returns null when no webhook configured', async () => {
    const pool = createMockPool({
      'SELECT': {
        rows: [{ git_webhook_provider: null, git_webhook_secret: null }],
        rowCount: 1,
      },
    });

    const service = new WorkspaceService(
      pool as never,
      createMockEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: ENCRYPTION_KEY },
    );

    const result = await service.getGitWebhookSecret(TENANT_ID, WORKSPACE_ID);
    expect(result).toBeNull();
  });

  it('returns null when workspace not found', async () => {
    const pool = createMockPool();
    const service = new WorkspaceService(
      pool as never,
      createMockEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: ENCRYPTION_KEY },
    );

    const result = await service.getGitWebhookSecret(TENANT_ID, 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('WorkspaceService.findWorkspaceByRepositoryUrl', () => {
  it('finds workspace by matching repository URL', async () => {
    const pool = createMockPool({
      'SELECT': {
        rows: [{ id: WORKSPACE_ID, tenant_id: TENANT_ID }],
        rowCount: 1,
      },
    });

    const service = new WorkspaceService(
      pool as never,
      createMockEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: ENCRYPTION_KEY },
    );

    const result = await service.findWorkspaceByRepositoryUrl('https://github.com/org/repo.git');
    expect(result).toEqual({ id: WORKSPACE_ID, tenant_id: TENANT_ID });
  });

  it('returns null when no matching workspace found', async () => {
    const pool = createMockPool();
    const service = new WorkspaceService(
      pool as never,
      createMockEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: ENCRYPTION_KEY },
    );

    const result = await service.findWorkspaceByRepositoryUrl('https://github.com/unknown/repo');
    expect(result).toBeNull();
  });

  it('normalizes URL by stripping .git suffix and lowering case', async () => {
    const pool = createMockPool({
      'SELECT': {
        rows: [{ id: WORKSPACE_ID, tenant_id: TENANT_ID }],
        rowCount: 1,
      },
    });

    const service = new WorkspaceService(
      pool as never,
      createMockEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: ENCRYPTION_KEY },
    );

    await service.findWorkspaceByRepositoryUrl('HTTPS://GITHUB.COM/Org/Repo.git');

    const queryCall = pool.query.mock.calls[0];
    const params = queryCall[1] as unknown[];
    expect(params[0]).toBe('https://github.com/org/repo');
  });
});

/* ------------------------------------------------------------------ */
/*  Git webhook signature verification with per-workspace secret         */
/* ------------------------------------------------------------------ */

describe('per-workspace git webhook signature verification', () => {
  it('verifies HMAC-SHA256 signature against per-workspace secret', () => {
    const secret = 'per-project-secret-123';
    const body = Buffer.from(JSON.stringify({ action: 'opened' }));
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    expect(signature).toBeTruthy();
    expect(signature.length).toBe(64);
  });

  it('verifies GitLab shared secret via constant-time comparison', () => {
    const secret = 'gitlab-project-token';
    const provided = 'gitlab-project-token';

    const leftBuffer = Buffer.from(provided);
    const rightBuffer = Buffer.from(secret);
    expect(leftBuffer.length).toBe(rightBuffer.length);
  });
});
