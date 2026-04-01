import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../src/errors/error-handler.js';
import { createFleetServiceMock } from './support.js';

vi.mock('../../../src/auth/fastify-auth-hook.js', () => ({
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

describe('fleet version summary route', () => {
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

  it('returns the stack version summary through the admin fleet surface', async () => {
    const { fleetRoutes } = await import('../../../src/api/routes/fleet/fleet.routes.js');
    const getSummary = vi.fn().mockResolvedValue({
      platform_api: {
        component: 'platform-api',
        image: 'ghcr.io/agirunner/agirunner-platform-api:0.1.0-rc.1',
        image_digest: 'sha256:platform-api',
        version: '0.1.0-rc.1',
        revision: 'abcdef123456',
        status: 'Up 5 minutes',
        started_at: '2026-03-31T18:22:00.000Z',
      },
      dashboard: {
        component: 'dashboard',
        image: 'ghcr.io/agirunner/agirunner-platform-dashboard:local',
        image_digest: null,
        version: 'local',
        revision: 'unlabeled',
        status: 'Up 5 minutes',
        started_at: '2026-03-31T18:22:30.000Z',
      },
      container_manager: null,
      runtimes: [
        {
          image: 'ghcr.io/agirunner/agirunner-runtime:0.1.0-rc.1',
          image_digest: 'sha256:runtime',
          version: '0.1.0-rc.1',
          revision: 'fedcba654321',
          total_containers: 2,
          orchestrator_containers: 1,
          specialist_runtime_containers: 1,
        },
      ],
    });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('fleetService', createFleetServiceMock());
    app.decorate('containerManagerVersionReader', { getSummary } as never);

    await app.register(fleetRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/fleet/version-summary',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(response.json()).toEqual({
      data: {
        platform_api: {
          component: 'platform-api',
          image: 'ghcr.io/agirunner/agirunner-platform-api:0.1.0-rc.1',
          image_digest: 'sha256:platform-api',
          version: '0.1.0-rc.1',
          revision: 'abcdef123456',
          status: 'Up 5 minutes',
          started_at: '2026-03-31T18:22:00.000Z',
        },
        dashboard: {
          component: 'dashboard',
          image: 'ghcr.io/agirunner/agirunner-platform-dashboard:local',
          image_digest: null,
          version: 'local',
          revision: 'unlabeled',
          status: 'Up 5 minutes',
          started_at: '2026-03-31T18:22:30.000Z',
        },
        container_manager: null,
        runtimes: [
          {
            image: 'ghcr.io/agirunner/agirunner-runtime:0.1.0-rc.1',
            image_digest: 'sha256:runtime',
            version: '0.1.0-rc.1',
            revision: 'fedcba654321',
            total_containers: 2,
            orchestrator_containers: 1,
            specialist_runtime_containers: 1,
          },
        ],
      },
    });
  });
});
