import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../src/errors/error-handler.js';

const serverState: {
  handler: ((req: { url?: string }, res: ServerResponseStub) => void | Promise<void>) | null;
} = {
  handler: null,
};

interface ServerResponseStub {
  writeHead: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

vi.mock('node:http', () => ({
  createServer: (
    handler: (req: { url?: string }, res: ServerResponseStub) => void | Promise<void>,
  ) => {
    serverState.handler = handler;
    return {
      listen: vi.fn(),
      on: vi.fn(),
      close: vi.fn(),
    };
  },
}));

vi.mock('../../../../src/auth/fastify-auth-hook.js', () => ({
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

describe('oauth routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    serverState.handler = null;
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  function buildDashboardCallbackRedirect(query: Record<string, string>): string {
    const callbackUrl = new URL('/auth/callback', 'http://localhost:3000');
    const providerPath = new URL('/config/llm', 'http://localhost:3000');
    providerPath.search = new URLSearchParams(query).toString();
    callbackUrl.searchParams.set('redirect_to', `${providerPath.pathname}${providerPath.search}`);
    return callbackUrl.toString();
  }

  function buildDashboardMcpRedirect(query: Record<string, string>): string {
    const callbackUrl = new URL('/auth/callback', 'http://localhost:3000');
    const providerPath = new URL('/integrations/mcp-servers', 'http://localhost:3000');
    providerPath.search = new URLSearchParams(query).toString();
    callbackUrl.searchParams.set('redirect_to', `${providerPath.pathname}${providerPath.search}`);
    return callbackUrl.toString();
  }

  it('redirects callback failures with sanitized oauth_error messages', async () => {
    const { oauthRoutes } = await import('../../../../src/api/routes/oauth.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { DASHBOARD_URL: 'http://localhost:3000' } as never);
    app.decorate('oauthService', {
      peekFlowKind: vi.fn().mockResolvedValue('llm_provider'),
      handleCallback: vi.fn().mockRejectedValue(
        new Error('OAuth token exchange failed: 401 access_token=sk-secret-value'),
      ),
      initiateFlow: vi.fn(),
      getStatus: vi.fn(),
      disconnect: vi.fn(),
    });
    app.decorate('remoteMcpOAuthService', {
      handleCallback: vi.fn(),
    });

    await app.register(oauthRoutes);

    const response = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };
    await serverState.handler?.(
      { url: '/auth/callback?code=test-code&state=test-state' },
      response,
    );

    expect(response.writeHead).toHaveBeenCalledWith(
      302,
      expect.objectContaining({
        Location: buildDashboardCallbackRedirect({
          oauth_error: 'OAuth callback failed. Retry the connection or reconnect the provider.',
        }),
      }),
    );
  });

  it('preserves non-secret callback error messages', async () => {
    const { oauthRoutes } = await import('../../../../src/api/routes/oauth.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { DASHBOARD_URL: 'http://localhost:3000' } as never);
    app.decorate('oauthService', {
      peekFlowKind: vi.fn().mockResolvedValue('llm_provider'),
      handleCallback: vi.fn().mockRejectedValue(new Error('Provider not configured for OAuth')),
      initiateFlow: vi.fn(),
      getStatus: vi.fn(),
      disconnect: vi.fn(),
    });
    app.decorate('remoteMcpOAuthService', {
      handleCallback: vi.fn(),
    });

    await app.register(oauthRoutes);

    const response = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };
    await serverState.handler?.(
      { url: '/auth/callback?code=test-code&state=test-state' },
      response,
    );

    expect(response.writeHead).toHaveBeenCalledWith(
      302,
      expect.objectContaining({
        Location: buildDashboardCallbackRedirect({
          oauth_error: 'Provider not configured for OAuth',
        }),
      }),
    );
  });

  it('routes successful provider callbacks through the dashboard auth bootstrap page', async () => {
    const { oauthRoutes } = await import('../../../../src/api/routes/oauth.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { DASHBOARD_URL: 'http://localhost:3000' } as never);
    app.decorate('oauthService', {
      peekFlowKind: vi.fn().mockResolvedValue('llm_provider'),
      handleCallback: vi.fn().mockResolvedValue({
        providerId: 'provider-1',
        email: 'operator@example.com',
      }),
      initiateFlow: vi.fn(),
      getStatus: vi.fn(),
      disconnect: vi.fn(),
    });
    app.decorate('remoteMcpOAuthService', {
      handleCallback: vi.fn(),
    });

    await app.register(oauthRoutes);

    const response = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };
    await serverState.handler?.(
      { url: '/auth/callback?code=test-code&state=test-state' },
      response,
    );

    expect(response.writeHead).toHaveBeenCalledWith(
      302,
      expect.objectContaining({
        Location: buildDashboardCallbackRedirect({
          oauth_success: 'true',
          provider_id: 'provider-1',
          oauth_email: 'operator@example.com',
        }),
      }),
    );
  });

  it('imports an oauth session through the admin api', async () => {
    const { oauthRoutes } = await import('../../../../src/api/routes/oauth.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { DASHBOARD_URL: 'http://localhost:3000' } as never);
    app.decorate('oauthService', {
      peekFlowKind: vi.fn(),
      handleCallback: vi.fn(),
      initiateFlow: vi.fn(),
      getStatus: vi.fn(),
      disconnect: vi.fn(),
      importAuthorizedSession: vi.fn().mockResolvedValue({
        providerId: 'provider-1',
        email: 'operator@example.com',
      }),
    });
    app.decorate('remoteMcpOAuthService', {
      handleCallback: vi.fn(),
    });

    await app.register(oauthRoutes);

    const payload = {
      profileId: 'openai-codex',
      providerName: 'OpenAI (Subscription)',
      credentials: {
        accessToken: 'enc:v1:access',
        refreshToken: 'enc:v1:refresh',
        authorizedAt: '2026-03-19T00:00:00.000Z',
      },
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/config/oauth/import-session',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        providerId: 'provider-1',
        email: 'operator@example.com',
      },
    });
    expect(app.oauthService.importAuthorizedSession).toHaveBeenCalledWith('tenant-1', 'user-1', payload);
  });

  it('serves the MCP oauth client metadata document', async () => {
    const { oauthRoutes } = await import('../../../../src/api/routes/oauth.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', {
      DASHBOARD_URL: 'http://localhost:3000',
      PLATFORM_PUBLIC_BASE_URL: 'https://platform.example.test',
    } as never);
    app.decorate('oauthService', {
      peekFlowKind: vi.fn(),
      handleCallback: vi.fn(),
      initiateFlow: vi.fn(),
      getStatus: vi.fn(),
      disconnect: vi.fn(),
      importAuthorizedSession: vi.fn(),
    });
    app.decorate('remoteMcpOAuthService', {
      handleCallback: vi.fn(),
    });

    await app.register(oauthRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth/mcp-client.json',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      client_name: 'Agirunner MCP',
      client_uri: 'https://platform.example.test',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'native',
      redirect_uris: ['http://localhost:1455/auth/callback'],
      token_endpoint_auth_method: 'none',
    });
  });

  it('adds the hosted remote MCP callback uri to the client metadata document when configured', async () => {
    const { oauthRoutes } = await import('../../../../src/api/routes/oauth.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', {
      DASHBOARD_URL: 'http://localhost:3000',
      PLATFORM_PUBLIC_BASE_URL: 'https://platform.example.test',
      REMOTE_MCP_HOSTED_CALLBACK_BASE_URL: 'https://oauth.example.test',
    } as never);
    app.decorate('oauthService', {
      peekFlowKind: vi.fn(),
      handleCallback: vi.fn(),
      initiateFlow: vi.fn(),
      getStatus: vi.fn(),
      disconnect: vi.fn(),
      importAuthorizedSession: vi.fn(),
    });
    app.decorate('remoteMcpOAuthService', {
      handleCallback: vi.fn(),
    });

    await app.register(oauthRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth/mcp-client.json',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      client_name: 'Agirunner MCP',
      client_uri: 'https://platform.example.test',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'native',
      redirect_uris: [
        'http://localhost:1455/auth/callback',
        'https://oauth.example.test/api/v1/oauth/callback',
      ],
      token_endpoint_auth_method: 'none',
    });
  });

  it('routes successful remote MCP callbacks through the dashboard auth bootstrap page', async () => {
    const { oauthRoutes } = await import('../../../../src/api/routes/oauth.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { DASHBOARD_URL: 'http://localhost:3000' } as never);
    app.decorate('oauthService', {
      peekFlowKind: vi.fn().mockResolvedValue('remote_mcp'),
      handleCallback: vi.fn(),
      initiateFlow: vi.fn(),
      getStatus: vi.fn(),
      disconnect: vi.fn(),
    });
    app.decorate('remoteMcpOAuthService', {
      handleCallback: vi.fn().mockResolvedValue({
        serverId: 'server-1',
        serverName: 'Docs MCP',
      }),
    });

    await app.register(oauthRoutes);

    const response = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };
    await serverState.handler?.(
      { url: '/auth/callback?code=test-code&state=test-state' },
      response,
    );

    expect(app.oauthService.peekFlowKind).toHaveBeenCalledWith('test-state');
    expect(app.remoteMcpOAuthService.handleCallback).toHaveBeenCalledWith('test-code', 'test-state');
    expect(response.writeHead).toHaveBeenCalledWith(
      302,
      expect.objectContaining({
        Location: buildDashboardMcpRedirect({
          oauth_success: 'true',
          remote_mcp_server_id: 'server-1',
          remote_mcp_server_name: 'Docs MCP',
        }),
      }),
    );
  });

  it('handles hosted remote MCP callbacks through the fastify route', async () => {
    const { oauthRoutes } = await import('../../../../src/api/routes/oauth.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', {
      DASHBOARD_URL: 'http://localhost:3000',
      REMOTE_MCP_HOSTED_CALLBACK_BASE_URL: 'https://oauth.example.test',
    } as never);
    app.decorate('oauthService', {
      peekFlowKind: vi.fn().mockResolvedValue('remote_mcp'),
      handleCallback: vi.fn(),
      initiateFlow: vi.fn(),
      getStatus: vi.fn(),
      disconnect: vi.fn(),
    });
    app.decorate('remoteMcpOAuthService', {
      handleCallback: vi.fn().mockResolvedValue({
        serverId: 'server-2',
        serverName: 'Hosted Docs MCP',
      }),
    });

    await app.register(oauthRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/oauth/callback?code=test-code&state=test-state',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      buildDashboardMcpRedirect({
        oauth_success: 'true',
        remote_mcp_server_id: 'server-2',
        remote_mcp_server_name: 'Hosted Docs MCP',
      }),
    );
  });
});
