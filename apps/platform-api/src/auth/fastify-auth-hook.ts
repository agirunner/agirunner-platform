import type { FastifyReply, FastifyRequest } from 'fastify';

import { UnauthorizedError } from '../errors/domain-errors.js';
import { parseBearerToken, verifyApiKey } from './api-key.js';
import { enforceScope, type ApiKeyScope } from './scope.js';

export async function authenticateApiKey(request: FastifyRequest): Promise<void> {
  const token = parseBearerToken(request.headers.authorization);
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
