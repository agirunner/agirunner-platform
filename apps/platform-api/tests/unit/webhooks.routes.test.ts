import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
}));

describe('webhook routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('does not expose admin webhook CRUD endpoints from the git webhook route module', async () => {
    const { webhookRoutes } = await import('../../src/api/routes/webhooks.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { GIT_WEBHOOK_MAX_PER_MINUTE: 60 } as never);
    app.log.warn = vi.fn();
    app.decorate('pgPool', { query: vi.fn() });
    app.decorate('workspaceService', {
      findWorkspaceByRepositoryUrl: vi.fn(),
      getGitWebhookSecret: vi.fn(),
    });
    app.decorate('taskLifecycleService', {
      receiveGitEvent: vi.fn(),
    });
    app.decorate('webhookService', {
      registerWebhook: vi.fn().mockResolvedValue({
        id: 'hook-1',
        url: 'https://hooks.example.com',
        event_types: ['task.*'],
        is_active: true,
        created_at: '2026-03-12T00:00:00.000Z',
        secret_configured: true,
      }),
      updateWebhook: vi.fn(),
      listWebhooks: vi.fn(),
      deleteWebhook: vi.fn(),
    });

    await app.register(webhookRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('registers the git webhook ingestion endpoint', async () => {
    const { webhookRoutes } = await import('../../src/api/routes/webhooks.routes.js');

    app = fastify();
    app.decorate('config', { GIT_WEBHOOK_MAX_PER_MINUTE: 60 } as never);
    app.decorate('pgPool', { query: vi.fn() } as never);
    app.decorate('workspaceService', {
      findWorkspaceByRepositoryUrl: vi.fn(),
      getGitWebhookSecret: vi.fn(),
    } as never);
    app.decorate('eventService', { emit: vi.fn() } as never);

    await app.register(webhookRoutes);

    const routes = app.printRoutes();
    expect(routes).toContain('webhooks/git (POST)');
  });

  it('rejects git webhooks when the matched workspace has no configured per-workspace secret', async () => {
    const { webhookRoutes } = await import('../../src/api/routes/webhooks.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { GIT_WEBHOOK_MAX_PER_MINUTE: 60 } as never);
    app.log.warn = vi.fn();
    app.decorate('pgPool', { query: vi.fn() });
    app.decorate('workspaceService', {
      findWorkspaceByRepositoryUrl: vi.fn().mockResolvedValue({ id: 'workspace-1', tenant_id: 'tenant-1' }),
      getGitWebhookSecret: vi.fn().mockResolvedValue(null),
    });
    app.decorate('taskLifecycleService', { receiveGitEvent: vi.fn() });
    app.decorate('webhookService', {
      registerWebhook: vi.fn(),
      updateWebhook: vi.fn(),
      listWebhooks: vi.fn(),
      deleteWebhook: vi.fn(),
    });
    app.decorate('eventService', { emit: vi.fn() });

    await app.register(webhookRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/git',
      headers: {
        'x-github-event': 'push',
        'x-hub-signature-256': 'sha256=deadbeef',
      },
      payload: {
        repository: { clone_url: 'https://github.com/agisnap/agirunner-test-fixtures' },
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        message: 'No matching workspace git webhook secret is configured',
      },
    });
  });
});
