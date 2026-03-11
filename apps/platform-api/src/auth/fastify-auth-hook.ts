import type { FastifyReply, FastifyRequest } from 'fastify';

import { ForbiddenError, UnauthorizedError } from '../errors/domain-errors.js';
import { setRequestAuthIdentity } from '../observability/request-context.js';
import { parseBearerToken, verifyApiKey, verifyJwtApiKeyIdentity, type ApiKeyIdentity } from './api-key.js';
import { verifyJwt, type UserJwtClaims } from './jwt.js';
import { scopeToRole } from './rbac.js';
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
    throw new UnauthorizedError('Missing authorization');
  }

  const identity = isJwtToken(token)
    ? await verifyJwtIdentity(request, token)
    : await verifyApiKey(request.server.pgPool, token);
  request.auth = identity;
  setRequestAuthIdentity(identity);
}

function isJwtToken(token: string): boolean {
  return token.split('.').length === 3;
}

async function verifyJwtIdentity(request: FastifyRequest, token: string): Promise<ApiKeyIdentity> {
  let rawClaims: Record<string, unknown>;

  try {
    rawClaims = await verifyJwt<Record<string, unknown>>(request.server, token);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
    if (code?.startsWith('FAST_JWT_')) {
      throw new UnauthorizedError('Invalid or expired access token');
    }
    throw error;
  }

  const tokenType = rawClaims.tokenType as string | undefined;

  if (tokenType === 'refresh' || tokenType === 'user_refresh') {
    throw new UnauthorizedError('Access token required');
  }

  if (tokenType === 'user_access') {
    return verifyUserJwtIdentity(request, rawClaims as unknown as UserJwtClaims);
  }

  const claims = rawClaims as Omit<ApiKeyIdentity, 'id'> & { keyId: string };

  return verifyJwtApiKeyIdentity(request.server.pgPool, {
    keyId: claims.keyId,
    tenantId: claims.tenantId,
    scope: claims.scope,
    ownerType: claims.ownerType,
    ownerId: claims.ownerId,
    keyPrefix: claims.keyPrefix,
  });
}

async function verifyUserJwtIdentity(request: FastifyRequest, claims: UserJwtClaims & { iat?: number }): Promise<ApiKeyIdentity> {
  const result = await request.server.pgPool.query<{ id: string; is_active: boolean; role: string; updated_at: Date }>(
    'SELECT id, is_active, role, updated_at FROM users WHERE id = $1 AND tenant_id = $2',
    [claims.userId, claims.tenantId],
  );

  if (!result.rowCount || !result.rows[0].is_active) {
    throw new UnauthorizedError('User account not found or inactive');
  }

  const user = result.rows[0];

  if (claims.iat) {
    // JWT iat is truncated to seconds; add 2s tolerance to avoid
    // false positives when the token is issued in the same second
    // the user record was created or updated.
    const tokenIssuedAt = new Date(claims.iat * 1000 + 2000);
    if (user.updated_at > tokenIssuedAt) {
      throw new UnauthorizedError('Token invalidated by account update');
    }
  }

  return {
    id: user.id,
    tenantId: claims.tenantId,
    scope: claims.scope,
    ownerType: 'user',
    ownerId: user.id,
    keyPrefix: '',
    role: user.role as import('./rbac.js').RbacRole,
    userId: user.id,
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

export function withAllowedScopes(allowedScopes: ApiKeyScope[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.auth) {
      throw new UnauthorizedError();
    }

    if (!allowedScopes.includes(request.auth.scope)) {
      throw new ForbiddenError('Insufficient scope');
    }
  };
}
