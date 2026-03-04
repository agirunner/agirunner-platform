import type { FastifyReply, FastifyRequest } from 'fastify';

import { UnauthorizedError } from '../errors/domain-errors.js';
import { parseBearerToken, verifyApiKey, type ApiKeyIdentity } from './api-key.js';
import { verifyJwt } from './jwt.js';
import { enforceScope, type ApiKeyScope } from './scope.js';

const ACCESS_COOKIE_NAME = 'agentbaton_access_token';

/**
 * Authenticate the request using either the Authorization header (Bearer token)
 * or the httpOnly access-token cookie. Header takes precedence.
 */
export async function authenticateApiKey(request: FastifyRequest): Promise<void> {
  let token: string;

  if (request.headers.authorization) {
    token = parseBearerToken(request.headers.authorization);
  } else if (request.cookies?.[ACCESS_COOKIE_NAME]) {
    token = request.cookies[ACCESS_COOKIE_NAME];
  } else {
    throw new UnauthorizedError('Missing authorization');
  }

  const identity = isJwtToken(token)
    ? await verifyJwtIdentity(request, token)
    : await verifyApiKey(request.server.pgPool, token);
  request.auth = identity;
}

function isJwtToken(token: string): boolean {
  return token.split('.').length === 3;
}

async function verifyJwtIdentity(request: FastifyRequest, token: string): Promise<ApiKeyIdentity> {
  const claims = await verifyJwt<
    Omit<ApiKeyIdentity, 'id'> & {
      keyId: string;
      tokenType?: string;
    }
  >(request.server, token);

  if (claims.tokenType === 'refresh') {
    throw new UnauthorizedError('Access token required');
  }

  return {
    id: claims.keyId,
    tenantId: claims.tenantId,
    scope: claims.scope,
    ownerType: claims.ownerType,
    ownerId: claims.ownerId,
    keyPrefix: claims.keyPrefix,
  };
}

export function withScope(requiredScope: ApiKeyScope) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.auth) {
      throw new UnauthorizedError();
    }

    enforceScope(request.auth.scope, requiredScope);
  };
}
