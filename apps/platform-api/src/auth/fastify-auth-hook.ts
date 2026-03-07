import type { FastifyReply, FastifyRequest } from 'fastify';

import { ForbiddenError, UnauthorizedError } from '../errors/domain-errors.js';
import { setRequestAuthIdentity } from '../observability/request-context.js';
import { DEFAULT_TENANT_ID } from '../db/seed.js';
import { parseBearerToken, verifyApiKey, verifyJwtApiKeyIdentity, type ApiKeyIdentity } from './api-key.js';
import { verifyJwt } from './jwt.js';
import { enforceScope, type ApiKeyScope } from './scope.js';

const ACCESS_COOKIE_NAME = 'agirunner_access_token';

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
    await request.server.auditService.record({
      tenantId: request.auth?.tenantId ?? DEFAULT_TENANT_ID,
      action: 'auth.request_denied',
      resourceType: 'system',
      outcome: 'failure',
      reason: 'missing_authorization',
      actorType: 'anonymous',
      actorId: null,
      metadata: { path: request.url, method: request.method },
    });
    throw new UnauthorizedError('Missing authorization');
  }

  try {
    const identity = isJwtToken(token)
      ? await verifyJwtIdentity(request, token)
      : await verifyApiKey(request.server.pgPool, token);
    request.auth = identity;
    setRequestAuthIdentity(identity);
  } catch (error) {
    await request.server.auditService.record({
      tenantId: DEFAULT_TENANT_ID,
      action: 'auth.request_denied',
      resourceType: 'system',
      outcome: 'failure',
      reason: error instanceof Error ? error.message : 'authentication_failed',
      actorType: 'anonymous',
      actorId: null,
      metadata: { path: request.url, method: request.method },
    });
    throw error;
  }
}

function isJwtToken(token: string): boolean {
  return token.split('.').length === 3;
}

async function verifyJwtIdentity(request: FastifyRequest, token: string): Promise<ApiKeyIdentity> {
  let claims: Omit<ApiKeyIdentity, 'id'> & {
    keyId: string;
    tokenType?: string;
  };

  try {
    claims = await verifyJwt<
      Omit<ApiKeyIdentity, 'id'> & {
        keyId: string;
        tokenType?: string;
      }
    >(request.server, token);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
    if (code?.startsWith('FAST_JWT_')) {
      throw new UnauthorizedError('Invalid or expired access token');
    }
    throw error;
  }

  if (claims.tokenType === 'refresh') {
    throw new UnauthorizedError('Access token required');
  }

  return verifyJwtApiKeyIdentity(request.server.pgPool, {
    keyId: claims.keyId,
    tenantId: claims.tenantId,
    scope: claims.scope,
    ownerType: claims.ownerType,
    ownerId: claims.ownerId,
    keyPrefix: claims.keyPrefix,
  });
}

export function withScope(requiredScope: ApiKeyScope) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.auth) {
      throw new UnauthorizedError();
    }

    try {
      enforceScope(request.auth.scope, requiredScope);
    } catch (error) {
      await request.server.auditService.record({
        tenantId: request.auth.tenantId,
        action: 'auth.request_denied',
        resourceType: 'system',
        outcome: 'failure',
        reason: error instanceof Error ? error.message : 'insufficient_scope',
        actorType: request.auth.ownerType,
        actorId: request.auth.ownerId,
        metadata: {
          path: request.url,
          method: request.method,
          required_scope: requiredScope,
          actual_scope: request.auth.scope,
        },
      });
      throw error;
    }
  };
}

export function withAllowedScopes(allowedScopes: ApiKeyScope[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.auth) {
      throw new UnauthorizedError();
    }

    if (!allowedScopes.includes(request.auth.scope)) {
      await request.server.auditService.record({
        tenantId: request.auth.tenantId,
        action: 'auth.request_denied',
        resourceType: 'system',
        outcome: 'failure',
        reason: 'insufficient_scope',
        actorType: request.auth.ownerType,
        actorId: request.auth.ownerId,
        metadata: {
          path: request.url,
          method: request.method,
          allowed_scopes: allowedScopes,
          actual_scope: request.auth.scope,
        },
      });
      throw new ForbiddenError('Insufficient scope');
    }
  };
}
