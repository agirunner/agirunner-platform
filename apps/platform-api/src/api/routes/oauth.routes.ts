import { createServer } from 'node:http';

import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { OAuthService } from '../../services/oauth-service.js';
import { listOAuthProfiles } from '../../config/oauth-profiles.js';
import { ValidationError } from '../../errors/domain-errors.js';

const OAUTH_CALLBACK_PORT = 1455;

export const oauthRoutes: FastifyPluginAsync = async (app) => {
  const service = new OAuthService(app.pgPool);

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

    const dashboardUrl = process.env.DASHBOARD_URL ?? 'http://localhost:3000';

    if (error) {
      res.writeHead(302, { Location: `${dashboardUrl}/config/llm?oauth_error=${encodeURIComponent(error)}` });
      res.end();
      return;
    }

    if (!code || !state) {
      res.writeHead(302, { Location: `${dashboardUrl}/config/llm?oauth_error=${encodeURIComponent('Missing code or state')}` });
      res.end();
      return;
    }

    try {
      const result = await service.handleCallback(code, state);
      const params = new URLSearchParams({ oauth_success: 'true', provider_id: result.providerId });
      if (result.email) params.set('oauth_email', result.email);
      res.writeHead(302, { Location: `${dashboardUrl}/config/llm?${params.toString()}` });
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OAuth callback failed';
      res.writeHead(302, { Location: `${dashboardUrl}/config/llm?oauth_error=${encodeURIComponent(message)}` });
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
