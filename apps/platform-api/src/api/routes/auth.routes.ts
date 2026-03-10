import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { parseBearerToken, verifyApiKey, verifyJwtApiKeyIdentity } from '../../auth/api-key.js';
import { issueAccessToken, issueRefreshToken, verifyJwt } from '../../auth/jwt.js';
import { UnauthorizedError } from '../../errors/domain-errors.js';
import { logAuthEvent } from '../../logging/auth-log.js';

const tokenExchangeSchema = z.object({ api_key: z.string().min(1) });
const ACCESS_COOKIE_NAME = 'agirunner_access_token';
const REFRESH_COOKIE_NAME = 'agirunner_refresh_token';
const CSRF_COOKIE_NAME = 'agirunner_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

interface RefreshTokenClaims {
  keyId: string;
  tenantId: string;
  scope: 'agent' | 'worker' | 'admin';
  ownerType: string;
  ownerId: string | null;
  keyPrefix: string;
  tokenType?: string;
  tokenId?: string;
  exp?: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function decodeTokenExpiry(token: string): string {
  const [, payload] = token.split('.');
  if (!payload) {
    throw new UnauthorizedError('Token is invalid');
  }

  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number };
  if (typeof parsed.exp !== 'number') {
    throw new UnauthorizedError('Token expiry is missing');
  }

  return new Date(parsed.exp * 1000).toISOString();
}

function accessCookieOptions(useSecureCookie: boolean) {
  return {
    httpOnly: true,
    secure: useSecureCookie,
    sameSite: 'strict' as const,
    path: '/',
  };
}

function refreshCookieOptions(useSecureCookie: boolean) {
  return {
    httpOnly: true,
    secure: useSecureCookie,
    sameSite: 'strict' as const,
    path: '/api/v1/auth/refresh',
  };
}

function csrfCookieOptions(useSecureCookie: boolean) {
  return {
    httpOnly: false,
    secure: useSecureCookie,
    sameSite: 'strict' as const,
    path: '/',
  };
}

function shouldUseSecureCookie(request: FastifyRequest): boolean {
  const forwarded = request.headers['x-forwarded-proto'];
  const protocolHeader = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const protocol = (protocolHeader ?? request.protocol ?? '').toLowerCase();
  return protocol === 'https';
}

function readHeaderValue(request: FastifyRequest, headerName: string): string | undefined {
  const value = request.headers[headerName];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function assertCsrfCookieFlow(request: FastifyRequest): string {
  const csrfCookie = request.cookies[CSRF_COOKIE_NAME];
  const csrfHeader = readHeaderValue(request, CSRF_HEADER_NAME);

  if (!csrfCookie || !csrfHeader) {
    throw new UnauthorizedError('CSRF token required');
  }

  const left = Buffer.from(csrfCookie);
  const right = Buffer.from(csrfHeader);

  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new UnauthorizedError('CSRF token mismatch');
  }

  return csrfHeader;
}

async function persistRefreshSession(
  request: FastifyRequest,
  input: {
    tokenId: string;
    apiKeyId: string;
    tenantId: string;
    csrfToken: string;
    expiresAtIso: string;
  },
): Promise<void> {
  await request.server.pgPool.query(
    `INSERT INTO refresh_token_sessions (tenant_id, api_key_id, token_id, csrf_token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.tenantId,
      input.apiKeyId,
      input.tokenId,
      sha256(input.csrfToken),
      new Date(input.expiresAtIso),
    ],
  );
}

function clearAuthCookies(reply: FastifyReply, useSecureCookie: boolean): void {
  reply.clearCookie(ACCESS_COOKIE_NAME, accessCookieOptions(useSecureCookie));
  reply.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(useSecureCookie));
  reply.clearCookie(CSRF_COOKIE_NAME, csrfCookieOptions(useSecureCookie));
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  const loginHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = tokenExchangeSchema.parse(request.body);

    let identity;
    try {
      identity = await verifyApiKey(app.pgPool, body.api_key);
    } catch (err) {
      void logAuthEvent(app.logService, {
        tenantId: '00000000-0000-0000-0000-000000000000',
        type: 'login_failed',
        method: 'api_key',
        actorType: 'system',
        actorId: 'unknown',
        actorName: 'Unknown',
        metadata: { failure_reason: 'invalid_credentials' },
      });
      throw err;
    }

    const token = await issueAccessToken(app, {
      keyId: identity.id,
      tenantId: identity.tenantId,
      scope: identity.scope,
      ownerType: identity.ownerType,
      ownerId: identity.ownerId,
      keyPrefix: identity.keyPrefix,
    });

    const refreshTokenId = randomUUID();
    const refreshToken = await issueRefreshToken(app, {
      keyId: identity.id,
      tenantId: identity.tenantId,
      scope: identity.scope,
      ownerType: identity.ownerType,
      ownerId: identity.ownerId,
      keyPrefix: identity.keyPrefix,
      tokenId: refreshTokenId,
    });

    const csrfToken = randomBytes(24).toString('base64url');
    const expiresAt = decodeTokenExpiry(token);
    const refreshExpiresAt = decodeTokenExpiry(refreshToken);

    await persistRefreshSession(request, {
      tokenId: refreshTokenId,
      apiKeyId: identity.id,
      tenantId: identity.tenantId,
      csrfToken,
      expiresAtIso: refreshExpiresAt,
    });

    const useSecureCookie = shouldUseSecureCookie(request);
    reply.setCookie(ACCESS_COOKIE_NAME, token, accessCookieOptions(useSecureCookie));
    reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(useSecureCookie));
    reply.setCookie(CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions(useSecureCookie));

    void logAuthEvent(app.logService, {
      tenantId: identity.tenantId,
      type: 'login',
      method: 'api_key',
      actorType: identity.ownerType,
      actorId: identity.ownerId ?? identity.id,
      actorName: `Key ${identity.keyPrefix}`,
      metadata: { scope: identity.scope, key_prefix: identity.keyPrefix },
    });

    return {
      data: {
        token,
        expires_at: expiresAt,
        refresh_expires_at: refreshExpiresAt,
        scope: identity.scope,
        tenant_id: identity.tenantId,
      },
    };
  };

  app.post('/api/v1/auth/token', loginHandler);
  app.post('/api/v1/auth/login', loginHandler);

  app.get('/api/v1/auth/me', async (request) => {
    const cookieToken = request.cookies[ACCESS_COOKIE_NAME];
    const headerToken = request.headers.authorization
      ? parseBearerToken(request.headers.authorization)
      : undefined;
    const token = cookieToken ?? headerToken;

    if (!token) {
      throw new UnauthorizedError('Authentication required');
    }

    const claims = await verifyJwt<RefreshTokenClaims>(app, token);

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
    const headerToken = request.headers.authorization
      ? parseBearerToken(request.headers.authorization)
      : undefined;
    const token = cookieToken ?? headerToken;

    if (!token) {
      throw new UnauthorizedError('Refresh token required');
    }

    let claims: RefreshTokenClaims;

    try {
      claims = await verifyJwt<RefreshTokenClaims>(app, token);
    } catch {
      throw new UnauthorizedError('Refresh token expired or invalid');
    }

    if (claims.tokenType !== 'refresh' || !claims.tokenId) {
      throw new UnauthorizedError('Refresh token required');
    }

    const csrfToken = cookieToken ? assertCsrfCookieFlow(request) : undefined;

    const keyIdentity = await verifyJwtApiKeyIdentity(app.pgPool, {
      keyId: claims.keyId,
      tenantId: claims.tenantId,
      scope: claims.scope,
      ownerType: claims.ownerType,
      ownerId: claims.ownerId,
      keyPrefix: claims.keyPrefix,
    });

    const client = await app.pgPool.connect();
    try {
      await client.query('BEGIN');

      const sessionResult = await client.query<{
        api_key_id: string;
        csrf_token_hash: string;
        revoked_at: Date | null;
        expires_at: Date;
      }>(
        `SELECT api_key_id, csrf_token_hash, revoked_at, expires_at
         FROM refresh_token_sessions
         WHERE tenant_id = $1 AND token_id = $2
         FOR UPDATE`,
        [keyIdentity.tenantId, claims.tokenId],
      );

      if (!sessionResult.rowCount) {
        throw new UnauthorizedError('Refresh token expired or invalid');
      }

      const session = sessionResult.rows[0];
      if (
        session.api_key_id !== keyIdentity.id
        || session.revoked_at
        || new Date(session.expires_at) <= new Date()
      ) {
        throw new UnauthorizedError('Refresh token expired or invalid');
      }

      if (csrfToken) {
        const expectedHash = Buffer.from(session.csrf_token_hash);
        const actualHash = Buffer.from(sha256(csrfToken));
        if (expectedHash.length !== actualHash.length || !timingSafeEqual(expectedHash, actualHash)) {
          throw new UnauthorizedError('CSRF token mismatch');
        }
      }

      const nextToken = await issueAccessToken(app, {
        keyId: keyIdentity.id,
        tenantId: keyIdentity.tenantId,
        scope: keyIdentity.scope,
        ownerType: keyIdentity.ownerType,
        ownerId: keyIdentity.ownerId,
        keyPrefix: keyIdentity.keyPrefix,
      });

      const nextRefreshTokenId = randomUUID();
      const nextRefreshToken = await issueRefreshToken(app, {
        keyId: keyIdentity.id,
        tenantId: keyIdentity.tenantId,
        scope: keyIdentity.scope,
        ownerType: keyIdentity.ownerType,
        ownerId: keyIdentity.ownerId,
        keyPrefix: keyIdentity.keyPrefix,
        tokenId: nextRefreshTokenId,
      });

      const nextCsrfToken = randomBytes(24).toString('base64url');
      const nextExpiresAt = decodeTokenExpiry(nextToken);
      const nextRefreshExpiresAt = decodeTokenExpiry(nextRefreshToken);

      await client.query(
        `UPDATE refresh_token_sessions
         SET revoked_at = now(), replaced_by_token_id = $3
         WHERE tenant_id = $1 AND token_id = $2`,
        [keyIdentity.tenantId, claims.tokenId, nextRefreshTokenId],
      );

      await client.query(
        `INSERT INTO refresh_token_sessions (tenant_id, api_key_id, token_id, csrf_token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          keyIdentity.tenantId,
          keyIdentity.id,
          nextRefreshTokenId,
          sha256(nextCsrfToken),
          new Date(nextRefreshExpiresAt),
        ],
      );

      await client.query('COMMIT');

      const useSecureCookie = shouldUseSecureCookie(request);
      reply.setCookie(ACCESS_COOKIE_NAME, nextToken, accessCookieOptions(useSecureCookie));
      reply.setCookie(REFRESH_COOKIE_NAME, nextRefreshToken, refreshCookieOptions(useSecureCookie));
      reply.setCookie(CSRF_COOKIE_NAME, nextCsrfToken, csrfCookieOptions(useSecureCookie));

      void logAuthEvent(app.logService, {
        tenantId: keyIdentity.tenantId,
        type: 'token_refresh',
        method: 'jwt',
        actorType: keyIdentity.ownerType,
        actorId: keyIdentity.ownerId ?? keyIdentity.id,
        actorName: `Key ${keyIdentity.keyPrefix}`,
      });

      return {
        data: {
          token: nextToken,
          expires_at: nextExpiresAt,
          refresh_expires_at: nextRefreshExpiresAt,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const useSecureCookie = shouldUseSecureCookie(request);

    const cookieToken = request.cookies[REFRESH_COOKIE_NAME];
    const headerToken = request.headers.authorization
      ? parseBearerToken(request.headers.authorization)
      : undefined;
    const token = cookieToken ?? headerToken;

    if (cookieToken) {
      assertCsrfCookieFlow(request);
    }

    if (token) {
      try {
        const claims = await verifyJwt<RefreshTokenClaims>(app, token);
        if (claims.tokenType === 'refresh' && claims.tokenId) {
          await app.pgPool.query(
            `UPDATE refresh_token_sessions
             SET revoked_at = now()
             WHERE tenant_id = $1 AND token_id = $2 AND revoked_at IS NULL`,
            [claims.tenantId, claims.tokenId],
          );
        }
      } catch {
        // Logout must be idempotent.
      }
    }

    clearAuthCookies(reply, useSecureCookie);

    void logAuthEvent(app.logService, {
      tenantId: '00000000-0000-0000-0000-000000000000',
      type: 'logout',
      method: 'jwt',
      actorType: 'system',
      actorId: 'system',
      actorName: 'System',
    });

    return {
      data: {
        logged_out: true,
      },
    };
  });
};
