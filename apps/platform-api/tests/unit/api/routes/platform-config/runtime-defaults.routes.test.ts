import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
import { RuntimeDefaultsService } from '../../../../../src/services/runtime-defaults-service.js';

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
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
  let eventService: { emit: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetAllMocks();
    pool = { query: vi.fn() };
    eventService = { emit: vi.fn().mockResolvedValue(undefined) };
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('redacts secret-bearing runtime defaults on list responses', async () => {
    const { runtimeDefaultsRoutes } = await import('../../../../../src/api/routes/platform-config/runtime-defaults.routes.js');

    app = fastify();
    registerErrorHandler(app);
    pool.query.mockResolvedValueOnce({ rows: [sampleSecretDefault], rowCount: 1 });
    app.decorate('runtimeDefaultsService', new RuntimeDefaultsService(pool as never));
    app.decorate('eventService', eventService as never);

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
    const { runtimeDefaultsRoutes } = await import('../../../../../src/api/routes/platform-config/runtime-defaults.routes.js');

    app = fastify();
    registerErrorHandler(app);
    pool.query.mockResolvedValueOnce({ rows: [sampleSecretDefault], rowCount: 1 });
    app.decorate('runtimeDefaultsService', new RuntimeDefaultsService(pool as never));
    app.decorate('eventService', eventService as never);

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

  it('logs config changes after runtime-default upsert', async () => {
    const { runtimeDefaultsRoutes } = await import('../../../../../src/api/routes/platform-config/runtime-defaults.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('runtimeDefaultsService', {
      listDefaults: vi.fn(),
      getDefault: vi.fn(),
      getByKey: vi.fn().mockResolvedValue(null),
      upsertDefault: vi.fn().mockResolvedValue({
        id: 'runtime-default-2',
        tenant_id: 'tenant-1',
        config_key: 'queue.max_depth',
        config_value: '100',
        config_type: 'number',
        description: 'Queue depth',
        created_at: new Date('2026-03-12T00:00:00Z'),
        updated_at: new Date('2026-03-12T00:00:00Z'),
      }),
      updateDefault: vi.fn(),
      deleteDefault: vi.fn(),
    } as never);
    app.decorate('eventService', eventService as never);

    await app.register(runtimeDefaultsRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/config/runtime-defaults',
      headers: { authorization: 'Bearer test' },
      payload: {
        configKey: 'queue.max_depth',
        configValue: '100',
        configType: 'number',
        description: 'Queue depth',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        type: 'config.runtime_default_changed',
        entityType: 'system',
        entityId: 'tenant-1',
        actorType: 'admin',
        actorId: 'prefix',
        data: expect.objectContaining({
          config_key: 'queue.max_depth',
          operation: 'create',
          config_type: 'number',
          description_present: true,
          secret_redacted: false,
          previous_value_present: false,
          new_value_present: true,
        }),
      }),
    );
  });

  it('logs config changes after runtime-default patch', async () => {
    const { runtimeDefaultsRoutes } = await import('../../../../../src/api/routes/platform-config/runtime-defaults.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('runtimeDefaultsService', {
      listDefaults: vi.fn(),
      getDefault: vi.fn().mockResolvedValue({
        id: 'runtime-default-2',
        tenant_id: 'tenant-1',
        config_key: 'queue.max_depth',
        config_value: '50',
        config_type: 'number',
        description: 'Queue depth',
        created_at: new Date('2026-03-12T00:00:00Z'),
        updated_at: new Date('2026-03-12T00:00:00Z'),
      }),
      getByKey: vi.fn(),
      upsertDefault: vi.fn(),
      updateDefault: vi.fn().mockResolvedValue({
        id: 'runtime-default-2',
        tenant_id: 'tenant-1',
        config_key: 'queue.max_depth',
        config_value: '100',
        config_type: 'number',
        description: 'Queue depth',
        created_at: new Date('2026-03-12T00:00:00Z'),
        updated_at: new Date('2026-03-12T00:00:00Z'),
      }),
      deleteDefault: vi.fn(),
    } as never);
    app.decorate('eventService', eventService as never);

    await app.register(runtimeDefaultsRoutes);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/config/runtime-defaults/runtime-default-2',
      headers: { authorization: 'Bearer test' },
      payload: {
        configValue: '100',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'config.runtime_default_changed',
        data: expect.objectContaining({
          config_key: 'queue.max_depth',
          operation: 'update',
          previous_value_present: true,
          new_value_present: true,
        }),
      }),
    );
  });

  it('logs redacted config changes after runtime-default delete', async () => {
    const { runtimeDefaultsRoutes } = await import('../../../../../src/api/routes/platform-config/runtime-defaults.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('runtimeDefaultsService', {
      listDefaults: vi.fn(),
      getDefault: vi.fn().mockResolvedValue(sampleSecretDefault),
      getByKey: vi.fn(),
      upsertDefault: vi.fn(),
      updateDefault: vi.fn(),
      deleteDefault: vi.fn().mockResolvedValue(undefined),
    } as never);
    app.decorate('eventService', eventService as never);

    await app.register(runtimeDefaultsRoutes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/config/runtime-defaults/runtime-default-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(204);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'config.runtime_default_changed',
        data: expect.objectContaining({
          config_key: 'custom.api_key_secret_ref',
          operation: 'delete',
          secret_redacted: true,
          previous_value_present: true,
          new_value_present: false,
        }),
      }),
    );
  });
});
