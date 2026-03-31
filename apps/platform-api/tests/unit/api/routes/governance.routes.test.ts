import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { governanceRoutes } from '../../src/api/routes/governance.routes.js';
import { registerErrorHandler } from '../../src/errors/error-handler.js';

const { configureApiKeyLoggingMock } = vi.hoisted(() => ({
  configureApiKeyLoggingMock: vi.fn(),
}));

vi.mock('../../src/auth/api-key.js', () => ({
  configureApiKeyLogging: configureApiKeyLoggingMock,
}));

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

describe('governance routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  function buildApp() {
    const governanceService = {
      getLoggingLevel: vi.fn().mockResolvedValue('debug'),
      setLoggingLevel: vi.fn().mockResolvedValue('debug'),
    };
    const logLevelCache = {
      invalidate: vi.fn(),
    };

    app = fastify({
      logger: {
        level: 'info',
      },
    });
    registerErrorHandler(app);
    app.decorate('governanceService', governanceService);
    app.decorate('logLevelCache', logLevelCache);

    return { app, governanceService, logLevelCache };
  }

  it('keeps tenant logging updates scoped to governance state for non-default tenants', async () => {
    const { app: appInstance, governanceService, logLevelCache } = buildApp();
    await appInstance.register(governanceRoutes);

    const response = await appInstance.inject({
      method: 'PUT',
      url: '/api/v1/governance/logging',
      headers: { authorization: 'Bearer test' },
      payload: { level: 'debug' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: { level: 'debug' },
    });
    expect(governanceService.setLoggingLevel).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'debug',
    );
    expect(logLevelCache.invalidate).toHaveBeenCalledWith('tenant-1');
    expect(appInstance.log.level).toBe('info');
    expect(configureApiKeyLoggingMock).not.toHaveBeenCalled();
  });
});
