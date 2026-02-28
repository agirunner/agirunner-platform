import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { parseBearerToken, verifyApiKey, verifyApiKeyById } from '../../auth/api-key.js';
import { issueAccessToken, issueRefreshToken, verifyJwt } from '../../auth/jwt.js';
import { UnauthorizedError } from '../../errors/domain-errors.js';

const tokenExchangeSchema = z.object({ api_key: z.string().min(20) });

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/auth/token', async (request) => {
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

    return {
      data: {
        token,
        refresh_token: refreshToken,
        scope: identity.scope,
        tenant_id: identity.tenantId,
      },
    };
  });

  app.post('/api/v1/auth/refresh', async (request) => {
    const token = parseBearerToken(request.headers.authorization);
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

    return {
      data: {
        token: nextToken,
        refresh_token: nextRefreshToken,
      },
    };
  });
};
