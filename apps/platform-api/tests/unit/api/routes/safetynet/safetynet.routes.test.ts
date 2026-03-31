import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('safetynet routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('returns the live safetynet inventory', async () => {
    const { safetynetRoutes } = await import('../../../../../src/api/routes/safetynet/safetynet.routes.js');

    app = fastify();
    await app.register(safetynetRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/system/safetynet-behaviors',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({
          id: 'platform.control_plane.idempotent_mutation_replay',
          layer: 'platform',
          kind: 'safetynet_behavior',
        }),
      ]),
    });
  });
});
