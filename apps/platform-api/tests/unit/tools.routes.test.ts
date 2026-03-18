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
      keyPrefix: 'admin-1',
    };
  },
  withScope: () => async () => {},
}));

describe('tool routes', () => {
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

  it('accepts current tool categories such as workflow on create', async () => {
    const { toolRoutes } = await import('../../src/api/routes/tools.routes.js');
    const createToolTag = vi.fn(async () => ({
      id: 'ship_handoff',
      name: 'Ship Handoff',
      description: 'Persist and publish the current handoff packet',
      category: 'workflow',
    }));

    app = fastify();
    registerErrorHandler(app);
    app.decorate('toolTagService', {
      listToolTags: vi.fn(),
      createToolTag,
      updateToolTag: vi.fn(),
      deleteToolTag: vi.fn(),
    });
    await app.register(toolRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tools',
      headers: { authorization: 'Bearer test' },
      payload: {
        id: 'ship_handoff',
        name: 'Ship Handoff',
        description: 'Persist and publish the current handoff packet',
        category: 'workflow',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(createToolTag).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      {
        id: 'ship_handoff',
        name: 'Ship Handoff',
        description: 'Persist and publish the current handoff packet',
        category: 'workflow',
      },
    );
  });
});
