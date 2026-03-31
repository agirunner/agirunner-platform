import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';

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

const SECRET_ERROR =
  'platform instructions must not contain pasted credentials, tokens, or secret values; use supported secret fields instead';

describe('platform instruction routes', () => {
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

  it('returns a validation error when platform instructions include secret material', async () => {
    const { platformInstructionRoutes } = await import(
      '../../../../../src/api/routes/platform-config/platform-instructions.routes.js'
    );
    const connect = vi.fn();

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(),
      connect,
    });
    app.decorate('eventService', { emit: vi.fn() });

    await app.register(platformInstructionRoutes);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/platform/instructions',
      headers: { authorization: 'Bearer test' },
      payload: {
        content: 'authorization = Bearer header.payload.signature',
        format: 'text',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: SECRET_ERROR,
      },
    });
    expect(connect).not.toHaveBeenCalled();
  });
});
