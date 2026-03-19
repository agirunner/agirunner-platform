import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

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

  it('redirects callback failures with sanitized oauth_error messages', async () => {
    const { oauthRoutes } = await import('../../src/api/routes/oauth.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { DASHBOARD_URL: 'http://localhost:3000' } as never);
    app.decorate('oauthService', {
      handleCallback: vi.fn().mockRejectedValue(
        new Error('OAuth token exchange failed: 401 access_token=sk-secret-value'),
      ),
      initiateFlow: vi.fn(),
      getStatus: vi.fn(),
      disconnect: vi.fn(),
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
    const { oauthRoutes } = await import('../../src/api/routes/oauth.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { DASHBOARD_URL: 'http://localhost:3000' } as never);
    app.decorate('oauthService', {
      handleCallback: vi.fn().mockRejectedValue(new Error('Provider not configured for OAuth')),
      initiateFlow: vi.fn(),
      getStatus: vi.fn(),
      disconnect: vi.fn(),
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
    const { oauthRoutes } = await import('../../src/api/routes/oauth.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { DASHBOARD_URL: 'http://localhost:3000' } as never);
    app.decorate('oauthService', {
      handleCallback: vi.fn().mockResolvedValue({
        providerId: 'provider-1',
        email: 'operator@example.com',
      }),
      initiateFlow: vi.fn(),
      getStatus: vi.fn(),
      disconnect: vi.fn(),
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
    const { oauthRoutes } = await import('../../src/api/routes/oauth.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { DASHBOARD_URL: 'http://localhost:3000' } as never);
    app.decorate('oauthService', {
      handleCallback: vi.fn(),
      initiateFlow: vi.fn(),
      getStatus: vi.fn(),
      disconnect: vi.fn(),
      importAuthorizedSession: vi.fn().mockResolvedValue({
        providerId: 'provider-1',
        email: 'operator@example.com',
      }),
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
});
