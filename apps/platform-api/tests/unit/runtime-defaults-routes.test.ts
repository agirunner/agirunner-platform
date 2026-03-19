import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';
import { RuntimeDefaultsService } from '../../src/services/runtime-defaults-service.js';

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

const sampleSecretDefault = {
  id: 'runtime-default-1',
  tenant_id: 'tenant-1',
  config_key: 'custom.api_key_secret_ref',
  config_value: 'redacted://runtime-default-secret',
  config_type: 'string',
  description: 'Custom secret ref',
  created_at: new Date('2026-03-12T00:00:00Z'),
  updated_at: new Date('2026-03-12T00:00:00Z'),
};

describe('runtime defaults routes', () => {
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

  it('redacts secret-bearing runtime defaults on list responses', async () => {
    const { runtimeDefaultsRoutes } = await import('../../src/api/routes/runtime-defaults.routes.js');

    app = fastify();
    registerErrorHandler(app);
    pool.query.mockResolvedValueOnce({ rows: [sampleSecretDefault], rowCount: 1 });
    app.decorate('runtimeDefaultsService', new RuntimeDefaultsService(pool as never));

    await app.register(runtimeDefaultsRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/config/runtime-defaults',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([expect.objectContaining({
      config_key: 'custom.api_key_secret_ref',
      config_value: 'redacted://runtime-default-secret',
    })]);
  });

  it('redacts secret-bearing runtime defaults on single-read responses', async () => {
    const { runtimeDefaultsRoutes } = await import('../../src/api/routes/runtime-defaults.routes.js');

    app = fastify();
    registerErrorHandler(app);
    pool.query.mockResolvedValueOnce({ rows: [sampleSecretDefault], rowCount: 1 });
    app.decorate('runtimeDefaultsService', new RuntimeDefaultsService(pool as never));

    await app.register(runtimeDefaultsRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/config/runtime-defaults/runtime-default-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(expect.objectContaining({
      config_key: 'custom.api_key_secret_ref',
      config_value: 'redacted://runtime-default-secret',
    }));
  });
});
