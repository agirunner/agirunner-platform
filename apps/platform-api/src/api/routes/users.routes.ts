import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';

import { authenticateApiKey } from '../../auth/fastify-auth-hook.js';
import { withRole, roleToScope } from '../../auth/rbac.js';
import { issueUserAccessToken, issueUserRefreshToken } from '../../auth/jwt.js';
import { DEFAULT_TENANT_ID } from '../../db/seed.js';
import { ForbiddenError, UnauthorizedError } from '../../errors/domain-errors.js';
import { UserService, type CreateUserInput, type UpdateUserInput } from '../../services/user-service.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const userService = new UserService(app.pgPool);

  app.post<{ Body: Record<string, unknown> }>(
    '/api/v1/auth/register',
    { preHandler: [authenticateApiKey, withRole('org_admin')] },
    async (request, reply) => {
      const input = request.body as CreateUserInput;
      const user = await userService.createUser(request.auth!.tenantId, input);
      return reply.status(201).send({ data: user });
    },
  );

  app.get('/api/v1/auth/sso/:provider', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const { getSSOProviderConfig, buildAuthorizationUrl } = await import('../../auth/sso-provider.js');

    const config = getSSOProviderConfig(provider);
    if (!config) {
      reply.status(400);
      return { error: `SSO provider '${provider}' is not configured` };
    }

    const state = randomBytes(32).toString('hex');
    reply.setCookie(`sso_state_${provider}`, state, {
      path: '/',
      httpOnly: true,
      maxAge: 300,
      sameSite: 'lax',
    });

    const url = buildAuthorizationUrl(provider, config, state);
    return reply.redirect(url);
  });

  app.get('/api/v1/auth/sso/:provider/callback', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const { code, state } = request.query as { code?: string; state?: string };
    const { getSSOProviderConfig, exchangeCodeForUser } = await import('../../auth/sso-provider.js');

    if (!code) {
      reply.status(400);
      return { error: 'Missing authorization code' };
    }

    const cookieName = `sso_state_${provider}`;
    const savedState = (request.cookies as Record<string, string>)?.[cookieName];
    if (!savedState || savedState !== state) {
      reply.status(403);
      return { error: 'Invalid state parameter' };
    }
    reply.clearCookie(cookieName, { path: '/' });

    const config = getSSOProviderConfig(provider);
    if (!config) {
      reply.status(400);
      return { error: `SSO provider '${provider}' is not configured` };
    }

    const ssoUser = await exchangeCodeForUser(provider, config, code);

    const ssoUserService = new UserService(app.pgPool);
    const tenantId = request.auth?.tenantId ?? DEFAULT_TENANT_ID;
    const user = await ssoUserService.findOrCreateFromSSO(
      tenantId,
      ssoUser.provider,
      ssoUser.providerUserId,
      ssoUser.email,
      ssoUser.displayName,
    );

    const scope = roleToScope(user.role);
    const accessToken = await issueUserAccessToken(app, {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      scope,
      email: user.email,
    });
    const refreshToken = await issueUserRefreshToken(app, {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      scope,
      email: user.email,
      tokenId: randomUUID(),
    });

    const dashboardUrl = process.env['AGIRUNNER_DASHBOARD_URL'] ?? 'http://localhost:3000';
    return reply.redirect(
      `${dashboardUrl}/auth/callback?access_token=${accessToken}&refresh_token=${refreshToken}`,
    );
  });

  app.get(
    '/api/v1/users',
    { preHandler: [authenticateApiKey, withRole('org_admin')] },
    async (request, reply) => {
      const users = await userService.listUsers(request.auth!.tenantId);
      return reply.send({ data: users });
    },
  );

  app.get(
    '/api/v1/users/me',
    { preHandler: [authenticateApiKey] },
    async (request, reply) => {
      if (!request.auth?.userId) {
        throw new UnauthorizedError('User authentication required');
      }
      const user = await userService.getUserById(request.auth.tenantId, request.auth.userId);
      return reply.send({ data: user });
    },
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/v1/users/:id',
    { preHandler: [authenticateApiKey, withRole('org_admin')] },
    async (request, reply) => {
      const input = request.body as UpdateUserInput;
      const user = await userService.updateUser(request.auth!.tenantId, request.params.id, input);
      return reply.send({ data: user });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/users/:id',
    { preHandler: [authenticateApiKey, withRole('org_admin')] },
    async (request, reply) => {
      if (request.auth?.userId === request.params.id) {
        throw new ForbiddenError('Cannot deactivate your own account');
      }
      await userService.deactivateUser(request.auth!.tenantId, request.params.id);
      return reply.status(204).send();
    },
  );
}
