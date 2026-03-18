import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'worker',
      ownerType: 'worker',
      ownerId: 'worker-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
}));

describe('runtime config routes', () => {
  let app: ReturnType<typeof fastify> | undefined;
  let pool: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetAllMocks();
    pool = { query: vi.fn() };
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('redacts secret-bearing defaults from worker runtime-config responses', async () => {
    const { runtimeConfigRoutes } = await import('../../src/api/routes/runtime-config.routes.js');

    pool.query
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      })
      .mockResolvedValueOnce({
        rows: [{
          name: 'worker-alpha',
          capabilities: ['coding', 'testing'],
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          name: 'developer',
          description: 'Implements features',
          system_prompt: 'You are a developer.',
          allowed_tools: ['file_read'],
          capabilities: ['coding', 'testing'],
          verification_strategy: 'peer_review',
          updated_at: new Date('2026-03-12T00:00:00Z'),
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          config_key: 'tools.web_search_api_key_secret_ref',
          config_value: 'legacy-plaintext-secret',
          config_type: 'string',
          updated_at: new Date('2026-03-12T00:00:00Z'),
        }],
        rowCount: 1,
      })

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);

    await app.register(runtimeConfigRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/runtime/config/worker-alpha',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.defaults).toEqual([
      {
        key: 'tools.web_search_api_key_secret_ref',
        value: 'redacted://runtime-config-secret',
        type: 'string',
      },
    ]);
  });
});
