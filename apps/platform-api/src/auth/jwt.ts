import type { FastifyInstance } from 'fastify';

import type { RbacRole } from './rbac.js';
import type { ApiKeyScope } from './scope.js';

export interface JwtClaims {
  keyId: string;
  tenantId: string;
  scope: ApiKeyScope;
  ownerType: string;
  ownerId: string | null;
  keyPrefix: string;
}

export interface UserJwtClaims {
  userId: string;
  tenantId: string;
  role: RbacRole;
  scope: ApiKeyScope;
  email: string;
}

export async function issueAccessToken(app: FastifyInstance, claims: JwtClaims): Promise<string> {
  return app.jwt.sign(claims, { expiresIn: app.config.JWT_EXPIRES_IN });
}

export async function issueRefreshToken(
  app: FastifyInstance,
  claims: JwtClaims & { tokenId: string; persistentSession?: boolean },
): Promise<string> {
  return app.jwt.sign(
    { ...claims, tokenType: 'refresh' },
    { expiresIn: app.config.JWT_REFRESH_EXPIRES_IN },
  );
}

export async function issueUserAccessToken(app: FastifyInstance, claims: UserJwtClaims): Promise<string> {
  return app.jwt.sign({ ...claims, tokenType: 'user_access' }, { expiresIn: app.config.JWT_EXPIRES_IN });
}

export async function issueUserRefreshToken(
  app: FastifyInstance,
  claims: UserJwtClaims & { tokenId: string },
): Promise<string> {
  return app.jwt.sign(
    { ...claims, tokenType: 'user_refresh' },
    { expiresIn: app.config.JWT_REFRESH_EXPIRES_IN },
  );
}

export async function verifyJwt<T extends object>(app: FastifyInstance, token: string): Promise<T> {
  return app.jwt.verify<T>(token);
}
