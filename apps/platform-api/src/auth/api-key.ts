import { randomBytes, timingSafeEqual } from 'node:crypto';

import bcrypt from 'bcryptjs';
import type pg from 'pg';

import { UnauthorizedError } from '../errors/domain-errors.js';
import type { ApiKeyScope } from './scope.js';

const DUMMY_API_KEY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5m8j6jVWeItPxX2VINeodIZ6Tn6PvxW';

export interface ApiKeyIdentity {
  id: string;
  tenantId: string;
  scope: ApiKeyScope;
  ownerType: string;
  ownerId: string | null;
  keyPrefix: string;
}

interface ApiKeyRow {
  id: string;
  tenant_id: string;
  scope: ApiKeyScope;
  owner_type: string;
  owner_id: string | null;
  key_prefix: string;
  key_hash: string;
  expires_at: Date;
  is_revoked: boolean;
}

export function parseBearerToken(header?: string): string {
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }

  return header.slice(7);
}

function toIdentity(row: ApiKeyRow): ApiKeyIdentity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scope: row.scope,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    keyPrefix: row.key_prefix,
  };
}

function isExpired(expiresAt: Date): boolean {
  return new Date(expiresAt) <= new Date();
}

export async function verifyApiKey(pool: pg.Pool, apiKeyRaw: string): Promise<ApiKeyIdentity> {
  if (!apiKeyRaw.startsWith('ab_') || apiKeyRaw.length < 20) {
    throw new UnauthorizedError('Invalid API key format');
  }

  const keyPrefix = apiKeyRaw.slice(0, 12);
  const result = await pool.query<ApiKeyRow>(
    `SELECT id, tenant_id, scope, owner_type, owner_id, key_prefix, key_hash, expires_at, is_revoked
     FROM api_keys
     WHERE key_prefix = $1`,
    [keyPrefix],
  );

  if (!result.rowCount) {
    await bcrypt.compare(apiKeyRaw, DUMMY_API_KEY_HASH);
    throw new UnauthorizedError('Invalid API key');
  }

  const key = result.rows[0];
  const prefixMatches = key.key_prefix.length === keyPrefix.length && timingSafeEqual(Buffer.from(key.key_prefix), Buffer.from(keyPrefix));
  const hashMatches = await bcrypt.compare(apiKeyRaw, key.key_hash);

  if (!prefixMatches || !hashMatches || key.is_revoked || isExpired(key.expires_at)) {
    throw new UnauthorizedError('Invalid API key');
  }

  void pool.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [key.id]);

  return toIdentity(key);
}

export async function verifyApiKeyById(pool: pg.Pool, keyId: string): Promise<ApiKeyIdentity> {
  const result = await pool.query<ApiKeyRow>(
    `SELECT id, tenant_id, scope, owner_type, owner_id, key_prefix, key_hash, expires_at, is_revoked
     FROM api_keys
     WHERE id = $1`,
    [keyId],
  );

  if (!result.rowCount) {
    throw new UnauthorizedError('Invalid API key');
  }

  const key = result.rows[0];
  if (key.is_revoked || isExpired(key.expires_at)) {
    throw new UnauthorizedError('Invalid API key');
  }

  return toIdentity(key);
}

export async function createApiKey(
  pool: pg.Pool,
  input: {
    tenantId: string;
    scope: ApiKeyScope;
    ownerType: string;
    ownerId?: string;
    label?: string;
    expiresAt: Date;
  },
): Promise<{ apiKey: string; keyPrefix: string }> {
  const randomPart = randomBytes(24).toString('base64url');
  const apiKey = `ab_${input.scope}_${randomPart}`;
  const keyPrefix = apiKey.slice(0, 12);
  const keyHash = await bcrypt.hash(apiKey, 12);

  await pool.query(
    `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, scope, owner_type, owner_id, label, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.tenantId,
      keyHash,
      keyPrefix,
      input.scope,
      input.ownerType,
      input.ownerId ?? null,
      input.label ?? null,
      input.expiresAt,
    ],
  );

  return { apiKey, keyPrefix };
}
