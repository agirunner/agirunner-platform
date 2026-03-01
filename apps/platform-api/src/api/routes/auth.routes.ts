import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { parseBearerToken, verifyApiKey, verifyApiKeyById } from '../../auth/api-key.js';
import { issueAccessToken, issueRefreshToken, verifyJwt } from '../../auth/jwt.js';
import { UnauthorizedError } from '../../errors/domain-errors.js';

const tokenExchangeSchema = z.object({ api_key: z.string().min(20) });
const REFRESH_COOKIE_NAME = 'agentbaton_refresh_token';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict' as const,
    path: '/api/v1/auth/refresh',
  };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  const loginHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = tokenExchangeSchema.parse(request.body);
    const identity = await verifyApiKey(app.pgPool, body.api_key);

    const token = await issueAccessToken(app, {
      keyId: identity.id,
      tenantId: identity.tenantId,
      scope: identity.scope,
      ownerType: identity.ownerType,
      ownerId: identity.ownerId,
      keyPrefix: identity.keyPrefix,
    });

    const refreshToken = await issueRefreshToken(app, {
      keyId: identity.id,
      tenantId: identity.tenantId,
      scope: identity.scope,
      ownerType: identity.ownerType,
      ownerId: identity.ownerId,
      keyPrefix: identity.keyPrefix,
    });

    reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
    return {
      data: {
        token,
        scope: identity.scope,
        tenant_id: identity.tenantId,
      },
    };
  };

  app.post('/api/v1/auth/token', loginHandler);
  app.post('/api/v1/auth/login', loginHandler);

  app.post('/api/v1/auth/refresh', async (request, reply) => {
    const cookieToken = request.cookies[REFRESH_COOKIE_NAME];
    const headerToken = request.headers.authorization ? parseBearerToken(request.headers.authorization) : undefined;
    const token = cookieToken ?? headerToken;

    if (!token) {
      throw new UnauthorizedError('Refresh token required');
    }

    const claims = await verifyJwt<{
      keyId: string;
      tenantId: string;
      scope: 'agent' | 'worker' | 'admin';
      ownerType: string;
      ownerId: string | null;
      keyPrefix: string;
      tokenType?: string;
    }>(app, token);

    if (claims.tokenType !== 'refresh') {
      throw new UnauthorizedError('Refresh token required');
    }

    const keyIdentity = await verifyApiKeyById(app.pgPool, claims.keyId);
    if (
      keyIdentity.tenantId !== claims.tenantId ||
      keyIdentity.scope !== claims.scope ||
      keyIdentity.ownerType !== claims.ownerType ||
      keyIdentity.ownerId !== claims.ownerId ||
      keyIdentity.keyPrefix !== claims.keyPrefix
    ) {
      throw new UnauthorizedError('Invalid API key');
    }

    const nextToken = await issueAccessToken(app, {
      keyId: keyIdentity.id,
      tenantId: keyIdentity.tenantId,
      scope: keyIdentity.scope,
      ownerType: keyIdentity.ownerType,
      ownerId: keyIdentity.ownerId,
      keyPrefix: keyIdentity.keyPrefix,
    });

    const nextRefreshToken = await issueRefreshToken(app, {
      keyId: keyIdentity.id,
      tenantId: keyIdentity.tenantId,
      scope: keyIdentity.scope,
      ownerType: keyIdentity.ownerType,
      ownerId: keyIdentity.ownerId,
      keyPrefix: keyIdentity.keyPrefix,
    });

    reply.setCookie(REFRESH_COOKIE_NAME, nextRefreshToken, refreshCookieOptions());
    return {
      data: {
        token: nextToken,
      },
    };
  });
};
