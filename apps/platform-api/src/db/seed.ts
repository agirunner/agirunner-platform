/**
 * Database seed — FR-754: Zero-config first run.
 *
 * On every server start this module ensures:
 *   1. A default tenant exists (idempotent via ON CONFLICT).
 *   2. A default admin API key exists for that tenant. The key is created
 *      exactly once; subsequent starts skip creation because the key_prefix
 *      is deterministic.
 *
 * The generated API key is printed to stdout only on first creation so
 * operators can copy it for initial setup. No config files are required for
 * a working first run.
 */

import { randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';
import type { DatabaseQueryable } from './database.js';

import { deriveApiKeyLookupHash } from '../auth/api-key-derivation.js';
import { ValidationError } from '../errors/domain-errors.js';

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Far-future expiry for the default admin API key.
 * Chosen to be effectively permanent for bootstrapping purposes.
 * Operators should rotate or replace with a proper expiry after setup.
 */
export const DEFAULT_API_KEY_EXPIRY = new Date('2099-12-31T23:59:59Z');

/** Fixed prefix used to detect whether the default key was already created. */
export const DEFAULT_ADMIN_KEY_PREFIX = 'ar_admin_def';

/**
 * Optional override for deterministic bootstrap in docker-compose deployments.
 *
 * When set, this key is used as the default admin key so companion services
 * (for example the standalone built-in worker process) can authenticate on
 * first boot without scraping logs.
 */
const DEFAULT_ADMIN_API_KEY_ENV = 'DEFAULT_ADMIN_API_KEY';
const PLATFORM_SERVICE_API_KEY_ENV = 'PLATFORM_SERVICE_API_KEY';
const DEFAULT_PLATFORM_SERVICE_KEY_LABEL = 'default-platform-service-key';

interface ExistingDefaultKeyRow {
  id: string;
  key_hash: string;
  key_lookup_hash: string | null;
  key_prefix: string;
}

export async function seedDefaultTenant(db: DatabaseQueryable, source: NodeJS.ProcessEnv = process.env): Promise<void> {
  await db.query(
    `INSERT INTO tenants (id, name, slug)
     VALUES ($1, 'Default', 'default')
     ON CONFLICT (slug) DO NOTHING`,
    [DEFAULT_TENANT_ID],
  );

  await seedDefaultAdminKey(db, source);
  await seedDefaultPlatformServiceKey(db, source);
}

/**
 * Creates the default admin API key on first run. Subsequent calls are
 * no-ops because we check for the fixed key prefix before inserting.
 *
 * The full key is printed to stdout only when it is first generated.
 */
async function seedDefaultAdminKey(db: DatabaseQueryable, source: NodeJS.ProcessEnv = process.env): Promise<void> {
  const configuredKey = getConfiguredDefaultAdminKey(source);

  const existing = await db.query<ExistingDefaultKeyRow>(
    `SELECT id, key_hash, key_lookup_hash FROM api_keys WHERE tenant_id = $1 AND key_prefix = $2 LIMIT 1`,
    [DEFAULT_TENANT_ID, DEFAULT_ADMIN_KEY_PREFIX],
  );

  if (existing.rowCount) {
    if (configuredKey) {
      const matches = await bcrypt.compare(configuredKey, existing.rows[0].key_hash);
      const configuredLookupHash = deriveApiKeyLookupHash(configuredKey);
      if (!matches) {
        await db.query(
          `UPDATE api_keys
           SET key_hash = $1,
               key_lookup_hash = $2,
               expires_at = $3,
               is_revoked = false
           WHERE id = $4`,
          [
            await bcrypt.hash(configuredKey, 12),
            configuredLookupHash,
            DEFAULT_API_KEY_EXPIRY,
            existing.rows[0].id,
          ],
        );
        console.info(`[seed] Default admin key rotated from ${DEFAULT_ADMIN_API_KEY_ENV}.`);
      } else if (existing.rows[0].key_lookup_hash !== configuredLookupHash) {
        await db.query(
          `UPDATE api_keys
           SET key_lookup_hash = $1
           WHERE id = $2`,
          [configuredLookupHash, existing.rows[0].id],
        );
      }
    }

    // Default key already exists — zero-config setup already complete.
    return;
  }

  // Generate a random suffix so the full key is secret.
  const randomSuffix = randomBytes(18).toString('base64url');
  // The prefix is fixed to allow idempotent detection across restarts.
  const generatedApiKey = `${DEFAULT_ADMIN_KEY_PREFIX}${randomSuffix}`;
  const apiKey = configuredKey ?? generatedApiKey;

  const keyHash = await bcrypt.hash(apiKey, 12);
  const keyLookupHash = deriveApiKeyLookupHash(apiKey);
  const expiresAt = DEFAULT_API_KEY_EXPIRY;

  await db.query(
    `INSERT INTO api_keys (tenant_id, key_hash, key_lookup_hash, key_prefix, scope, owner_type, label, expires_at)
     VALUES ($1, $2, $3, $4, 'admin', 'system', 'default-admin-key', $5)
     ON CONFLICT DO NOTHING`,
    [DEFAULT_TENANT_ID, keyHash, keyLookupHash, DEFAULT_ADMIN_KEY_PREFIX, expiresAt],
  );

  if (configuredKey) {
    console.info(`[seed] Default admin key loaded from ${DEFAULT_ADMIN_API_KEY_ENV}.`);
    return;
  }

  // Print the key exactly once so the operator can bootstrap their first
  // workflow without any additional configuration (FR-754).
  console.info('');
  console.info('┌─────────────────────────────────────────────────────┐');
  console.info('│  Agirunner — Zero-Config First Run                 │');
  console.info('│                                                     │');
  console.info(`│  Default Admin API Key:                             │`);
  console.info(`│  ${apiKey.padEnd(51)}│`);
  console.info('│                                                     │');
  console.info('│  Store this key — it will not be shown again.       │');
  console.info('└─────────────────────────────────────────────────────┘');
  console.info('');
}

async function seedDefaultPlatformServiceKey(
  db: DatabaseQueryable,
  source: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const configuredKey = getConfiguredPlatformServiceKey(source);
  if (!configuredKey) {
    return;
  }

  const configuredLookupHash = deriveApiKeyLookupHash(configuredKey);
  const existing = await db.query<ExistingDefaultKeyRow>(
    `SELECT id, key_hash, key_lookup_hash, key_prefix
       FROM api_keys
      WHERE tenant_id = $1
        AND scope = 'service'
        AND owner_type = 'service'
        AND label = $2
      LIMIT 1`,
    [DEFAULT_TENANT_ID, DEFAULT_PLATFORM_SERVICE_KEY_LABEL],
  );

  if (existing.rowCount) {
    const [row] = existing.rows;
    const matches = await bcrypt.compare(configuredKey, row.key_hash);
    if (!matches || row.key_lookup_hash !== configuredLookupHash) {
      await db.query(
        `UPDATE api_keys
            SET key_hash = $1,
                key_lookup_hash = $2,
                key_prefix = $3,
                expires_at = $4,
                is_revoked = false
          WHERE id = $5`,
        [
          await bcrypt.hash(configuredKey, 12),
          configuredLookupHash,
          configuredKey.slice(0, 12),
          DEFAULT_API_KEY_EXPIRY,
          row.id,
        ],
      );
      console.info(`[seed] Default platform service key rotated from ${PLATFORM_SERVICE_API_KEY_ENV}.`);
    }
    return;
  }

  await db.query(
    `INSERT INTO api_keys (tenant_id, key_hash, key_lookup_hash, key_prefix, scope, owner_type, label, expires_at)
     VALUES ($1, $2, $3, $4, 'service', 'service', $5, $6)`,
    [
      DEFAULT_TENANT_ID,
      await bcrypt.hash(configuredKey, 12),
      configuredLookupHash,
      configuredKey.slice(0, 12),
      DEFAULT_PLATFORM_SERVICE_KEY_LABEL,
      DEFAULT_API_KEY_EXPIRY,
    ],
  );

  console.info(`[seed] Default platform service key loaded from ${PLATFORM_SERVICE_API_KEY_ENV}.`);
}

function getConfiguredDefaultAdminKey(source: NodeJS.ProcessEnv = process.env): string | null {
  const raw = source[DEFAULT_ADMIN_API_KEY_ENV];
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  const key = raw.trim();
  if (key.length < 1) {
    throw new Error(`${DEFAULT_ADMIN_API_KEY_ENV} must not be empty.`);
  }

  return key;
}

function getConfiguredPlatformServiceKey(source: NodeJS.ProcessEnv = process.env): string | null {
  const raw = source[PLATFORM_SERVICE_API_KEY_ENV];
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  const key = raw.trim();
  if (!/^ar_service_[A-Za-z0-9_-]{16,}$/.test(key)) {
    throw new ValidationError(
      `${PLATFORM_SERVICE_API_KEY_ENV} must use the canonical ar_service_<secret> format.`,
    );
  }

  return key;
}
