import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { parseBearerToken, verifyApiKey, verifyJwtApiKeyIdentity } from '../../auth/api-key.js';
import { issueAccessToken, issueRefreshToken, verifyJwt } from '../../auth/jwt.js';
import { UnauthorizedError } from '../../errors/domain-errors.js';

const tokenExchangeSchema = z.object({ api_key: z.string().min(20) });
const ACCESS_COOKIE_NAME = 'agentbaton_access_token';
const REFRESH_COOKIE_NAME = 'agentbaton_refresh_token';

/** Cookie options for the httpOnly access token cookie. */
function accessCookieOptions(useSecureCookie: boolean) {
  return {
    httpOnly: true,
    secure: useSecureCookie,
    sameSite: 'strict' as const,
    path: '/',
  };
}

/** Cookie options for the httpOnly refresh token cookie. */
function refreshCookieOptions(useSecureCookie: boolean) {
  return {
    httpOnly: true,
    secure: useSecureCookie,
    sameSite: 'strict' as const,
    path: '/api/v1/auth/refresh',
  };
}

function shouldUseSecureCookie(request: FastifyRequest): boolean {
  const forwarded = request.headers['x-forwarded-proto'];
  const protocolHeader = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const protocol = (protocolHeader ?? request.protocol ?? '').toLowerCase();
  return protocol === 'https';
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

    const useSecureCookie = shouldUseSecureCookie(request);
    reply.setCookie(ACCESS_COOKIE_NAME, token, accessCookieOptions(useSecureCookie));
    reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(useSecureCookie));
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

  /**
   * GET /api/v1/auth/me — Returns the authenticated user's identity from
   * the httpOnly access-token cookie (or Authorization header).
   * Dashboard clients use this instead of parsing localStorage tokens.
   */
  app.get('/api/v1/auth/me', async (request) => {
    const cookieToken = request.cookies[ACCESS_COOKIE_NAME];
    const headerToken = request.headers.authorization
      ? parseBearerToken(request.headers.authorization)
      : undefined;
    const token = cookieToken ?? headerToken;

    if (!token) {
      throw new UnauthorizedError('Authentication required');
    }

    const claims = await verifyJwt<{
      keyId: string;
      tenantId: string;
      scope: 'agent' | 'worker' | 'admin';
      ownerType: string;
      ownerId: string | null;
      keyPrefix: string;
    }>(app, token);

    const keyIdentity = await verifyJwtApiKeyIdentity(app.pgPool, {
      keyId: claims.keyId,
      tenantId: claims.tenantId,
      scope: claims.scope,
      ownerType: claims.ownerType,
      ownerId: claims.ownerId,
      keyPrefix: claims.keyPrefix,
    });

    return {
      data: {
        authenticated: true,
        scope: keyIdentity.scope,
        tenant_id: keyIdentity.tenantId,
        owner_type: keyIdentity.ownerType,
        owner_id: keyIdentity.ownerId,
      },
    };
  });

  app.post('/api/v1/auth/refresh', async (request, reply) => {
    const cookieToken = request.cookies[REFRESH_COOKIE_NAME];
    const headerToken = request.headers.authorization ? parseBearerToken(request.headers.authorization) : undefined;
    const token = cookieToken ?? headerToken;

    if (!token) {
      throw new UnauthorizedError('Refresh token required');
    }

    let claims: {
      keyId: string;
      tenantId: string;
      scope: 'agent' | 'worker' | 'admin';
      ownerType: string;
      ownerId: string | null;
      keyPrefix: string;
      tokenType?: string;
    };

    try {
      claims = await verifyJwt<{
        keyId: string;
        tenantId: string;
        scope: 'agent' | 'worker' | 'admin';
        ownerType: string;
        ownerId: string | null;
        keyPrefix: string;
        tokenType?: string;
      }>(app, token);
    } catch {
      throw new UnauthorizedError('Refresh token expired or invalid');
    }

    if (claims.tokenType !== 'refresh') {
      throw new UnauthorizedError('Refresh token required');
    }

    const keyIdentity = await verifyJwtApiKeyIdentity(app.pgPool, {
      keyId: claims.keyId,
      tenantId: claims.tenantId,
      scope: claims.scope,
      ownerType: claims.ownerType,
      ownerId: claims.ownerId,
      keyPrefix: claims.keyPrefix,
    });

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

    const useSecureCookie = shouldUseSecureCookie(request);
    reply.setCookie(ACCESS_COOKIE_NAME, nextToken, accessCookieOptions(useSecureCookie));
    reply.setCookie(REFRESH_COOKIE_NAME, nextRefreshToken, refreshCookieOptions(useSecureCookie));
    return {
      data: {
        token: nextToken,
      },
    };
  });
};
