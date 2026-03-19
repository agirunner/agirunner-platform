import { createServer } from 'node:http';

import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { listOAuthProfiles } from '../../catalogs/oauth-profiles.js';
import { ValidationError } from '../../errors/domain-errors.js';
import type { ImportOAuthSessionInput } from '../../services/oauth-service.js';

const OAUTH_CALLBACK_PORT = 1455;
const GENERIC_OAUTH_ERROR = 'OAuth callback failed. Retry the connection or reconnect the provider.';
const DASHBOARD_AUTH_CALLBACK_PATH = '/auth/callback';
const OAUTH_PROVIDER_RETURN_PATH = '/config/llm';
const DASHBOARD_REDIRECT_PARAM = 'redirect_to';

export const oauthRoutes: FastifyPluginAsync = async (app) => {
  const service = app.oauthService;
  const dashboardUrl = app.config.DASHBOARD_URL;

  // ── Admin API routes ────────────────────────────────────────────────

  app.get(
    '/api/v1/config/oauth/profiles',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async () => ({
      data: listOAuthProfiles().map((p) => ({
        profileId: p.profileId,
        displayName: p.displayName,
        description: p.description,
        providerType: p.providerType,
        costModel: p.costModel,
        staticModels: p.staticModels,
      })),
    }),
  );

  app.post(
    '/api/v1/config/oauth/authorize',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const body = request.body as { profileId?: string };
      if (!body.profileId) {
        throw new ValidationError('profileId is required');
      }

      const userId = request.auth!.userId ?? request.auth!.ownerId ?? request.auth!.id;
      const result = await service.initiateFlow(
        request.auth!.tenantId,
        userId,
        body.profileId,
      );

      return { data: result };
    },
  );

  app.post(
    '/api/v1/config/oauth/import-session',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const userId = request.auth!.userId ?? request.auth!.ownerId ?? request.auth!.id;
      return {
        data: await service.importAuthorizedSession(
          request.auth!.tenantId,
          userId,
          request.body as ImportOAuthSessionInput,
        ),
      };
    },
  );

  app.get(
    '/api/v1/config/oauth/providers/:id/status',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await service.getStatus(params.id) };
    },
  );

  app.post(
    '/api/v1/config/oauth/providers/:id/disconnect',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      await service.disconnect(params.id);
      reply.status(204);
    },
  );

  // ── Localhost callback server on port 1455 ────────────────────────────
  // Matches the OpenAI Codex CLI redirect URI: http://localhost:1455/auth/callback

  const callbackServer = createServer(async (req, res) => {
    if (!req.url?.startsWith('/auth/callback')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(302, {
        Location: buildDashboardRedirect(dashboardUrl, {
          oauth_error: sanitizeOAuthRedirectMessage(error),
        }),
      });
      res.end();
      return;
    }

    if (!code || !state) {
      res.writeHead(302, {
        Location: buildDashboardRedirect(dashboardUrl, {
          oauth_error: 'Missing code or state',
        }),
      });
      res.end();
      return;
    }

    try {
      const result = await service.handleCallback(code, state);
      const query: Record<string, string> = {
        oauth_success: 'true',
        provider_id: result.providerId,
      };
      if (result.email) {
        query.oauth_email = result.email;
      }
      res.writeHead(302, { Location: buildDashboardRedirect(dashboardUrl, query) });
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : GENERIC_OAUTH_ERROR;
      res.writeHead(302, {
        Location: buildDashboardRedirect(dashboardUrl, {
          oauth_error: sanitizeOAuthRedirectMessage(message),
        }),
      });
      res.end();
    }
  });

  callbackServer.listen(OAUTH_CALLBACK_PORT, '0.0.0.0', () => {
    app.log.info(`OAuth callback server listening on port ${OAUTH_CALLBACK_PORT}`);
  });

  callbackServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      app.log.warn(`OAuth callback port ${OAUTH_CALLBACK_PORT} already in use — callback server not started`);
    } else {
      app.log.error(err, 'OAuth callback server error');
    }
  });

  // Shut down the callback server when Fastify closes
  app.addHook('onClose', async () => {
    callbackServer.close();
  });
};

function buildDashboardRedirect(
  dashboardUrl: string,
  query: Record<string, string>,
): string {
  const callbackUrl = new URL(DASHBOARD_AUTH_CALLBACK_PATH, dashboardUrl);
  callbackUrl.searchParams.set(
    DASHBOARD_REDIRECT_PARAM,
    buildProviderReturnPath(query),
  );
  return callbackUrl.toString();
}

function buildProviderReturnPath(query: Record<string, string>): string {
  const params = new URLSearchParams(query);
  const queryString = params.toString();
  if (!queryString) {
    return OAUTH_PROVIDER_RETURN_PATH;
  }

  return `${OAUTH_PROVIDER_RETURN_PATH}?${queryString}`;
}

function sanitizeOAuthRedirectMessage(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return GENERIC_OAUTH_ERROR;
  }
  if (containsSecretLikeValue(normalized)) {
    return GENERIC_OAUTH_ERROR;
  }
  return normalized.length > 180 ? `${normalized.slice(0, 179)}...` : normalized;
}

function containsSecretLikeValue(value: string): boolean {
  return (
    /(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|bearer|api[_-]?key|password|secret)/i.test(value)
    || /enc:v\d+:/i.test(value)
    || /secret:[A-Z0-9_:-]+/i.test(value)
    || /Bearer\s+\S+/i.test(value)
    || /\b(?:sk|rk|ghp|ghu|github_pat)_[A-Za-z0-9_-]{8,}\b/.test(value)
    || /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)
  );
}
