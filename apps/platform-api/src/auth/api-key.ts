import { randomBytes, timingSafeEqual } from 'node:crypto';

import bcrypt from 'bcryptjs';

import type { DatabaseQueryable } from '../db/database.js';
import { DEFAULT_ADMIN_KEY_PREFIX } from '../db/seed.js';
import { UnauthorizedError } from '../errors/domain-errors.js';
import { createLogger } from '../observability/logger.js';
import {
  deriveApiKeyLookupHash,
  deriveApiKeyLookupPrefixes,
  deriveCanonicalKeyPrefix,
  isSupportedApiKeyFormat,
} from './api-key-derivation.js';
import { clearPersistedApiKeyLastUsed, shouldPersistApiKeyLastUsed } from './api-key-last-used-cache.js';
import type { ApiKeyScope } from './scope.js';

const DUMMY_API_KEY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5m8j6jVWeItPxX2VINeodIZ6Tn6PvxW';
let logger = createLogger('info');

export function configureApiKeyLogging(level: string): void {
  logger = createLogger(level);
}

export interface ApiKeyIdentity {
  id: string;
  tenantId: string;
  scope: ApiKeyScope;
  ownerType: string;
  ownerId: string | null;
  keyPrefix: string;
  role?: import('./rbac.js').RbacRole;
  userId?: string;
}

export interface JwtApiKeyClaims {
  keyId: string;
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
  key_lookup_hash: string | null;
  key_hash: string;
  expires_at: Date;
  is_revoked: boolean;
  tenant_is_active: boolean;
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

export async function verifyApiKey(pool: DatabaseQueryable, apiKeyRaw: string): Promise<ApiKeyIdentity> {
  if (!isSupportedApiKeyFormat(apiKeyRaw)) {
    const bootstrapIdentity = await verifyBootstrapApiKey(pool, apiKeyRaw);
    if (bootstrapIdentity) {
      return bootstrapIdentity;
    }
    throw new UnauthorizedError('Invalid API key format');
  }

  const lookupHash = deriveApiKeyLookupHash(apiKeyRaw);
  const hashResult = await pool.query<ApiKeyRow>(
    `SELECT k.id, k.tenant_id, k.scope, k.owner_type, k.owner_id, k.key_prefix, k.key_lookup_hash, k.key_hash, k.expires_at, k.is_revoked,
            t.is_active AS tenant_is_active
     FROM api_keys k
     JOIN tenants t ON t.id = k.tenant_id
     WHERE k.key_lookup_hash = $1
     LIMIT 1`,
    [lookupHash],
  );

  if (hashResult.rowCount) {
    const key = hashResult.rows[0];
    if (key.is_revoked || isExpired(key.expires_at) || !key.tenant_is_active) {
      throw new UnauthorizedError('Invalid API key');
    }
    persistLastUsedAt(pool, key.id);
    return toIdentity(key);
  }

  const keyPrefixes = deriveApiKeyLookupPrefixes(apiKeyRaw);
  const result = await pool.query<ApiKeyRow>(
    `SELECT k.id, k.tenant_id, k.scope, k.owner_type, k.owner_id, k.key_prefix, k.key_lookup_hash, k.key_hash, k.expires_at, k.is_revoked,
            t.is_active AS tenant_is_active
     FROM api_keys k
     JOIN tenants t ON t.id = k.tenant_id
     WHERE k.key_prefix = ANY($1::varchar[])`,
    [keyPrefixes],
  );

  if (!result.rowCount) {
    await bcrypt.compare(apiKeyRaw, DUMMY_API_KEY_HASH);
    throw new UnauthorizedError('Invalid API key');
  }

  for (const key of result.rows) {
    const prefixMatches = keyPrefixes.some(
      (prefix) =>
        key.key_prefix.length === prefix.length && timingSafeEqual(Buffer.from(key.key_prefix), Buffer.from(prefix)),
    );

    if (!prefixMatches) {
      continue;
    }

    const hashMatches = await bcrypt.compare(apiKeyRaw, key.key_hash);

    if (!hashMatches || key.is_revoked || isExpired(key.expires_at) || !key.tenant_is_active) {
      continue;
    }

    if (!key.key_lookup_hash) {
      persistLookupHashAndLastUsedAt(pool, key.id, lookupHash);
      return toIdentity(key);
    }

    persistLastUsedAt(pool, key.id);
    return toIdentity(key);
  }

  throw new UnauthorizedError('Invalid API key');
}

async function verifyBootstrapApiKey(
  pool: DatabaseQueryable,
  apiKeyRaw: string,
): Promise<ApiKeyIdentity | null> {
  const lookupHash = deriveApiKeyLookupHash(apiKeyRaw);
  const hashResult = await pool.query<ApiKeyRow>(
    `SELECT k.id, k.tenant_id, k.scope, k.owner_type, k.owner_id, k.key_prefix, k.key_lookup_hash, k.key_hash, k.expires_at, k.is_revoked,
            t.is_active AS tenant_is_active
     FROM api_keys k
     JOIN tenants t ON t.id = k.tenant_id
     WHERE k.key_lookup_hash = $1
     LIMIT 1`,
    [lookupHash],
  );

  if (hashResult.rowCount) {
    const key = hashResult.rows[0];
    if (!key.is_revoked && !isExpired(key.expires_at) && key.tenant_is_active) {
      persistLastUsedAt(pool, key.id);
      return toIdentity(key);
    }
    return null;
  }

  const result = await pool.query<ApiKeyRow>(
    `SELECT k.id, k.tenant_id, k.scope, k.owner_type, k.owner_id, k.key_prefix, k.key_lookup_hash, k.key_hash, k.expires_at, k.is_revoked,
            t.is_active AS tenant_is_active
     FROM api_keys k
     JOIN tenants t ON t.id = k.tenant_id
     WHERE k.key_prefix = $1
     LIMIT 1`,
    [DEFAULT_ADMIN_KEY_PREFIX],
  );

  if (!result.rowCount) {
    await bcrypt.compare(apiKeyRaw, DUMMY_API_KEY_HASH);
    return null;
  }

  const key = result.rows[0];
  const hashMatches = await bcrypt.compare(apiKeyRaw, key.key_hash);

  if (!hashMatches || key.is_revoked || isExpired(key.expires_at) || !key.tenant_is_active) {
    return null;
  }

  if (!key.key_lookup_hash) {
    persistLookupHashAndLastUsedAt(pool, key.id, lookupHash);
    return toIdentity(key);
  }

  persistLastUsedAt(pool, key.id);
  return toIdentity(key);
}

export async function verifyApiKeyById(pool: DatabaseQueryable, keyId: string): Promise<ApiKeyIdentity> {
  const result = await pool.query<ApiKeyRow>(
    `SELECT k.id, k.tenant_id, k.scope, k.owner_type, k.owner_id, k.key_prefix, k.key_lookup_hash, k.key_hash, k.expires_at, k.is_revoked,
            t.is_active AS tenant_is_active
     FROM api_keys k
     JOIN tenants t ON t.id = k.tenant_id
     WHERE k.id = $1`,
    [keyId],
  );

  if (!result.rowCount) {
    throw new UnauthorizedError('Invalid API key');
  }

  const key = result.rows[0];
  if (key.is_revoked || isExpired(key.expires_at) || !key.tenant_is_active) {
    throw new UnauthorizedError('Invalid API key');
  }

  return toIdentity(key);
}

export async function verifyJwtApiKeyIdentity(pool: DatabaseQueryable, claims: JwtApiKeyClaims): Promise<ApiKeyIdentity> {
  const keyIdentity = await verifyApiKeyById(pool, claims.keyId);
  if (
    keyIdentity.tenantId !== claims.tenantId ||
    keyIdentity.scope !== claims.scope ||
    keyIdentity.ownerType !== claims.ownerType ||
    keyIdentity.ownerId !== claims.ownerId ||
    keyIdentity.keyPrefix !== claims.keyPrefix
  ) {
    throw new UnauthorizedError('Invalid API key');
  }

  return keyIdentity;
}

const API_KEY_INSERT_RETRY_LIMIT = 8;

function generateApiKeyValue(scope: ApiKeyScope): string {
  const bodyEntropy = randomBytes(24).toString('base64url');
  return `ar_${scope}_${bodyEntropy}`;
}

function isApiKeyPrefixConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  if (code !== '23505') {
    return false;
  }

  const constraint =
    'constraint' in error ? String((error as { constraint?: unknown }).constraint ?? '') : '';
  return constraint === 'idx_api_keys_prefix';
}

export async function createApiKey(
  pool: DatabaseQueryable,
  input: {
    tenantId: string;
    scope: ApiKeyScope;
    ownerType: string;
    ownerId?: string;
    label?: string;
    expiresAt: Date;
  },
): Promise<{ apiKey: string; keyPrefix: string }> {
  for (let attempt = 1; attempt <= API_KEY_INSERT_RETRY_LIMIT; attempt += 1) {
    const apiKey = generateApiKeyValue(input.scope);
    const keyPrefix = deriveCanonicalKeyPrefix(apiKey);
    const keyLookupHash = deriveApiKeyLookupHash(apiKey);
    const keyHash = await bcrypt.hash(apiKey, 12);

    try {
      await pool.query(
        `INSERT INTO api_keys (tenant_id, key_hash, key_lookup_hash, key_prefix, scope, owner_type, owner_id, label, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          input.tenantId,
          keyHash,
          keyLookupHash,
          keyPrefix,
          input.scope,
          input.ownerType,
          input.ownerId ?? null,
          input.label ?? null,
          input.expiresAt,
        ],
      );

      return { apiKey, keyPrefix };
    } catch (error) {
      if (!isApiKeyPrefixConflict(error) || attempt === API_KEY_INSERT_RETRY_LIMIT) {
        throw error;
      }
    }
  }

  throw new Error('createApiKey exhausted prefix collision retries');
}

function persistLastUsedAt(pool: DatabaseQueryable, keyId: string): void {
  if (!shouldPersistApiKeyLastUsed(keyId)) {
    return;
  }

  void pool
    .query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [keyId])
    .catch((error) => {
      clearPersistedApiKeyLastUsed(keyId);
      logger.error({ err: error, keyId }, 'api_key_last_used_at_update_failed');
    });
}

function persistLookupHashAndLastUsedAt(
  pool: DatabaseQueryable,
  keyId: string,
  lookupHash: string,
): void {
  void pool
    .query(
      `UPDATE api_keys
       SET key_lookup_hash = COALESCE(key_lookup_hash, $2),
           last_used_at = now()
       WHERE id = $1`,
      [keyId, lookupHash],
    )
    .catch((error) => logger.error({ err: error, keyId }, 'api_key_lookup_hash_update_failed'));
}
