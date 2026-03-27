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
      userId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
}));

describe('remote mcp oauth client profile routes', () => {
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

  it('lists oauth client profiles', async () => {
    const { remoteMcpOAuthClientProfileRoutes } = await import('../../src/api/routes/remote-mcp-oauth-client-profiles.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('remoteMcpOAuthClientProfileService', {
      listProfiles: vi.fn().mockResolvedValue([{ id: 'profile-1', name: 'Hosted OAuth Client' }]),
      getProfile: vi.fn(),
      createProfile: vi.fn(),
      updateProfile: vi.fn(),
      deleteProfile: vi.fn(),
    });

    await app.register(remoteMcpOAuthClientProfileRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/remote-mcp-oauth-client-profiles',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [{ id: 'profile-1', name: 'Hosted OAuth Client' }] });
  });

  it('creates oauth client profiles', async () => {
    const { remoteMcpOAuthClientProfileRoutes } = await import('../../src/api/routes/remote-mcp-oauth-client-profiles.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('remoteMcpOAuthClientProfileService', {
      listProfiles: vi.fn(),
      getProfile: vi.fn(),
      createProfile: vi.fn().mockResolvedValue({ id: 'profile-1', name: 'Hosted OAuth Client' }),
      updateProfile: vi.fn(),
      deleteProfile: vi.fn(),
    });

    await app.register(remoteMcpOAuthClientProfileRoutes);

    const payload = {
      name: 'Hosted OAuth Client',
      description: '',
      issuer: 'https://auth.example.test',
      authorizationEndpoint: 'https://auth.example.test/oauth/authorize',
      tokenEndpoint: 'https://auth.example.test/oauth/token',
      callbackMode: 'loopback',
      tokenEndpointAuthMethod: 'client_secret_post',
      clientId: 'client-123',
      clientSecret: 'client-secret',
      defaultScopes: ['openid'],
      defaultResourceIndicators: [],
      defaultAudiences: [],
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/remote-mcp-oauth-client-profiles',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(app.remoteMcpOAuthClientProfileService.createProfile).toHaveBeenCalledWith('tenant-1', payload);
  });

  it('deletes oauth client profiles', async () => {
    const { remoteMcpOAuthClientProfileRoutes } = await import('../../src/api/routes/remote-mcp-oauth-client-profiles.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('remoteMcpOAuthClientProfileService', {
      listProfiles: vi.fn(),
      getProfile: vi.fn(),
      createProfile: vi.fn(),
      updateProfile: vi.fn(),
      deleteProfile: vi.fn().mockResolvedValue(undefined),
    });

    await app.register(remoteMcpOAuthClientProfileRoutes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/remote-mcp-oauth-client-profiles/profile-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(204);
    expect(app.remoteMcpOAuthClientProfileService.deleteProfile).toHaveBeenCalledWith('tenant-1', 'profile-1');
  });
});
