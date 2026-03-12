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

  it('redirects callback failures with sanitized oauth_error messages', async () => {
    const { oauthRoutes } = await import('../../src/api/routes/oauth.routes.js');

    app = fastify();
    registerErrorHandler(app);
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
        Location:
          'http://localhost:3000/config/llm?'
          + new URLSearchParams({
            oauth_error: 'OAuth callback failed. Retry the connection or reconnect the provider.',
          }).toString(),
      }),
    );
  });

  it('preserves non-secret callback error messages', async () => {
    const { oauthRoutes } = await import('../../src/api/routes/oauth.routes.js');

    app = fastify();
    registerErrorHandler(app);
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
        Location:
          'http://localhost:3000/config/llm?'
          + new URLSearchParams({
            oauth_error: 'Provider not configured for OAuth',
          }).toString(),
      }),
    );
  });
});
