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

describe('remote mcp server routes', () => {
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

  it('lists remote MCP servers', async () => {
    const { remoteMcpServerRoutes } = await import('../../src/api/routes/remote-mcp-servers.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('remoteMcpServerService', {
      listServers: vi.fn().mockResolvedValue([{ id: 'server-1', name: 'Docs MCP' }]),
      getServer: vi.fn(),
      setArchived: vi.fn(),
    });
    app.decorate('remoteMcpVerificationService', {
      createServer: vi.fn(),
      updateServer: vi.fn(),
      reverifyServer: vi.fn(),
    });
    app.decorate('remoteMcpOAuthService', {
      initiateDraftAuthorization: vi.fn(),
      reconnectServer: vi.fn(),
      disconnectServer: vi.fn(),
    });

    await app.register(remoteMcpServerRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/remote-mcp-servers',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [{ id: 'server-1', name: 'Docs MCP' }] });
  });

  it('creates remote MCP servers through the verification gate', async () => {
    const { remoteMcpServerRoutes } = await import('../../src/api/routes/remote-mcp-servers.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('remoteMcpServerService', {
      listServers: vi.fn(),
      getServer: vi.fn(),
      setArchived: vi.fn(),
    });
    app.decorate('remoteMcpVerificationService', {
      createServer: vi.fn().mockResolvedValue({ id: 'server-1', name: 'Docs MCP' }),
      updateServer: vi.fn(),
      reverifyServer: vi.fn(),
    });
    app.decorate('remoteMcpOAuthService', {
      initiateDraftAuthorization: vi.fn(),
      reconnectServer: vi.fn(),
      disconnectServer: vi.fn(),
    });

    await app.register(remoteMcpServerRoutes);

    const payload = {
      name: 'Docs MCP',
      description: '',
      endpointUrl: 'https://mcp.example.test/server',
      authMode: 'none',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: false,
      parameters: [],
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/remote-mcp-servers',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(app.remoteMcpVerificationService.createServer).toHaveBeenCalledWith('tenant-1', payload);
  });

  it('starts an oauth-backed remote MCP registration draft', async () => {
    const { remoteMcpServerRoutes } = await import('../../src/api/routes/remote-mcp-servers.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('remoteMcpServerService', {
      listServers: vi.fn(),
      getServer: vi.fn(),
      setArchived: vi.fn(),
    });
    app.decorate('remoteMcpVerificationService', {
      createServer: vi.fn(),
      updateServer: vi.fn(),
      reverifyServer: vi.fn(),
    });
    app.decorate('remoteMcpOAuthService', {
      initiateDraftAuthorization: vi.fn().mockResolvedValue({
        draftId: 'draft-1',
        authorizeUrl: 'https://auth.example.test/oauth/authorize?state=state-1',
      }),
      reconnectServer: vi.fn(),
      disconnectServer: vi.fn(),
    });

    await app.register(remoteMcpServerRoutes);

    const payload = {
      name: 'Docs MCP',
      description: '',
      endpointUrl: 'https://mcp.example.test/server',
      authMode: 'oauth',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: true,
      parameters: [],
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/remote-mcp-servers/oauth/authorize',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        draftId: 'draft-1',
        authorizeUrl: 'https://auth.example.test/oauth/authorize?state=state-1',
      },
    });
    expect(app.remoteMcpOAuthService.initiateDraftAuthorization).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      payload,
    );
  });

  it('starts an oauth reconnect flow for an existing remote MCP server', async () => {
    const { remoteMcpServerRoutes } = await import('../../src/api/routes/remote-mcp-servers.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('remoteMcpServerService', {
      listServers: vi.fn(),
      getServer: vi.fn(),
      setArchived: vi.fn(),
    });
    app.decorate('remoteMcpVerificationService', {
      createServer: vi.fn(),
      updateServer: vi.fn(),
      reverifyServer: vi.fn(),
    });
    app.decorate('remoteMcpOAuthService', {
      initiateDraftAuthorization: vi.fn(),
      reconnectServer: vi.fn().mockResolvedValue({
        serverId: 'server-1',
        authorizeUrl: 'https://auth.example.test/oauth/authorize?state=state-2',
      }),
      disconnectServer: vi.fn(),
    });

    await app.register(remoteMcpServerRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/remote-mcp-servers/server-1/oauth/reconnect',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        serverId: 'server-1',
        authorizeUrl: 'https://auth.example.test/oauth/authorize?state=state-2',
      },
    });
    expect(app.remoteMcpOAuthService.reconnectServer).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      'server-1',
    );
  });

  it('disconnects oauth credentials from an existing remote MCP server', async () => {
    const { remoteMcpServerRoutes } = await import('../../src/api/routes/remote-mcp-servers.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('remoteMcpServerService', {
      listServers: vi.fn(),
      getServer: vi.fn(),
      setArchived: vi.fn(),
    });
    app.decorate('remoteMcpVerificationService', {
      createServer: vi.fn(),
      updateServer: vi.fn(),
      reverifyServer: vi.fn(),
    });
    app.decorate('remoteMcpOAuthService', {
      initiateDraftAuthorization: vi.fn(),
      reconnectServer: vi.fn(),
      disconnectServer: vi.fn().mockResolvedValue(undefined),
    });

    await app.register(remoteMcpServerRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/remote-mcp-servers/server-1/oauth/disconnect',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(204);
    expect(app.remoteMcpOAuthService.disconnectServer).toHaveBeenCalledWith('tenant-1', 'server-1');
  });
});
