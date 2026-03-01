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
import type pg from 'pg';

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Far-future expiry for the default admin API key.
 * Chosen to be effectively permanent for bootstrapping purposes.
 * Operators should rotate or replace with a proper expiry after setup.
 */
export const DEFAULT_API_KEY_EXPIRY = new Date('2099-12-31T23:59:59Z');

/** Fixed prefix used to detect whether the default key was already created. */
const DEFAULT_ADMIN_KEY_PREFIX = 'ab_admin_def';

/**
 * Optional override for deterministic bootstrap in docker-compose deployments.
 *
 * When set, this key is used as the default admin key so companion services
 * (for example the standalone built-in worker process) can authenticate on
 * first boot without scraping logs.
 */
const DEFAULT_ADMIN_API_KEY_ENV = 'DEFAULT_ADMIN_API_KEY';

interface ExistingDefaultKeyRow {
  id: string;
  key_hash: string;
}

export async function seedDefaultTenant(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO tenants (id, name, slug)
     VALUES ($1, 'Default', 'default')
     ON CONFLICT (slug) DO NOTHING`,
    [DEFAULT_TENANT_ID],
  );

  await seedDefaultAdminKey(pool);
}

/**
 * Creates the default admin API key on first run. Subsequent calls are
 * no-ops because we check for the fixed key prefix before inserting.
 *
 * The full key is printed to stdout only when it is first generated.
 */
async function seedDefaultAdminKey(pool: pg.Pool): Promise<void> {
  const configuredKey = getConfiguredDefaultAdminKey();

  const existing = await pool.query<ExistingDefaultKeyRow>(
    `SELECT id, key_hash FROM api_keys WHERE tenant_id = $1 AND key_prefix = $2 LIMIT 1`,
    [DEFAULT_TENANT_ID, DEFAULT_ADMIN_KEY_PREFIX],
  );

  if (existing.rowCount) {
    if (configuredKey) {
      const matches = await bcrypt.compare(configuredKey, existing.rows[0].key_hash);
      if (!matches) {
        throw new Error(
          `${DEFAULT_ADMIN_API_KEY_ENV} does not match the existing default admin key in the database. `
          + 'Use the original key or reset the database volume before changing it.',
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
  const expiresAt = DEFAULT_API_KEY_EXPIRY;

  await pool.query(
    `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, scope, owner_type, label, expires_at)
     VALUES ($1, $2, $3, 'admin', 'system', 'default-admin-key', $4)
     ON CONFLICT DO NOTHING`,
    [DEFAULT_TENANT_ID, keyHash, DEFAULT_ADMIN_KEY_PREFIX, expiresAt],
  );

  if (configuredKey) {
    console.info(`[seed] Default admin key loaded from ${DEFAULT_ADMIN_API_KEY_ENV}.`);
    return;
  }

  // Print the key exactly once so the operator can bootstrap their first
  // pipeline without any additional configuration (FR-754).
  console.info('');
  console.info('┌─────────────────────────────────────────────────────┐');
  console.info('│  AgentBaton — Zero-Config First Run                 │');
  console.info('│                                                     │');
  console.info(`│  Default Admin API Key:                             │`);
  console.info(`│  ${apiKey.padEnd(51)}│`);
  console.info('│                                                     │');
  console.info('│  Store this key — it will not be shown again.       │');
  console.info('└─────────────────────────────────────────────────────┘');
  console.info('');
}

function getConfiguredDefaultAdminKey(source: NodeJS.ProcessEnv = process.env): string | null {
  const raw = source[DEFAULT_ADMIN_API_KEY_ENV];
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  const key = raw.trim();
  if (!key.startsWith(DEFAULT_ADMIN_KEY_PREFIX)) {
    throw new Error(
      `${DEFAULT_ADMIN_API_KEY_ENV} must start with ${DEFAULT_ADMIN_KEY_PREFIX} to match bootstrap key format.`,
    );
  }

  if (key.length < 20) {
    throw new Error(`${DEFAULT_ADMIN_API_KEY_ENV} must be at least 20 characters.`);
  }

  return key;
}
