import type { FastifyReply, FastifyRequest } from 'fastify';

import { UnauthorizedError } from '../errors/domain-errors.js';
import { parseBearerToken, verifyApiKey } from './api-key.js';
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

  const identity = await verifyApiKey(request.server.pgPool, token);
  request.auth = identity;
}

export function withScope(requiredScope: ApiKeyScope) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.auth) {
      throw new UnauthorizedError();
    }

    enforceScope(request.auth.scope, requiredScope);
  };
}
