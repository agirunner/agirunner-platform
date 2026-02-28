import type { FastifyInstance } from 'fastify';

import type { ApiKeyScope } from './scope.js';

export interface JwtClaims {
  keyId: string;
  tenantId: string;
  scope: ApiKeyScope;
  ownerType: string;
  ownerId: string | null;
  keyPrefix: string;
}

export async function issueAccessToken(app: FastifyInstance, claims: JwtClaims): Promise<string> {
  return app.jwt.sign(claims, { expiresIn: app.config.JWT_EXPIRES_IN });
}

export async function issueRefreshToken(app: FastifyInstance, claims: JwtClaims): Promise<string> {
  return app.jwt.sign({ ...claims, tokenType: 'refresh' }, { expiresIn: app.config.JWT_REFRESH_EXPIRES_IN });
}

export async function verifyJwt<T extends object>(app: FastifyInstance, token: string): Promise<T> {
  return app.jwt.verify<T>(token);
}
