import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../../../src/db/migrations/run-migrations.js';
import {
  isContainerRuntimeAvailable,
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from './postgres.js';

const canRunIntegration = isContainerRuntimeAvailable();
const TENANT_ID = '00000000-0000-0000-0000-000000000099';

describe.runIf(canRunIntegration)('runtime default scale migration', () => {
  let db: TestDatabase | null = null;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    if (db) {
      await stopTestDatabase(db);
    }
  });

  it('updates old seeded defaults while preserving custom overrides', async () => {
    expect(db).not.toBeNull();
    const pool = db!.pool;

    await pool.query(
      `INSERT INTO tenants (id, name, slug)
       VALUES ($1, 'Scale Migration Tenant', 'scale-migration-tenant')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_ID],
    );

    await pool.query(
      `INSERT INTO runtime_defaults (tenant_id, config_key, config_value, config_type)
       VALUES
         ($1, 'tasks.default_timeout_minutes', '30', 'number'),
         ($1, 'platform.api_request_timeout_seconds', '30', 'number'),
         ($1, 'container_manager.stop_timeout_seconds', '30', 'number'),
         ($1, 'agent.max_iterations', '500', 'number'),
         ($1, 'tools.shell_exec_timeout_seconds', '120', 'number'),
         ($1, 'workspace.clone_timeout_seconds', '120', 'number'),
         ($1, 'capture.push_retries', '3', 'number'),
         ($1, 'platform.log_flush_interval_ms', '750', 'number'),
         ($1, 'agent.history_max_messages', '200', 'number')
       ON CONFLICT (tenant_id, config_key) DO UPDATE
       SET
         config_value = EXCLUDED.config_value,
         config_type = EXCLUDED.config_type,
         updated_at = NOW()`,
      [TENANT_ID],
    );

    await pool.query(
      `DELETE FROM schema_migrations
        WHERE filename = '0054_scale_runtime_defaults.sql'`,
    );

    await runMigrations(
      pool,
      await createMigrationSubsetDir(['0054_scale_runtime_defaults.sql']),
    );

    const rows = await pool.query<{ config_key: string; config_value: string }>(
      `SELECT config_key, config_value
         FROM runtime_defaults
        WHERE tenant_id = $1
          AND config_key IN (
            'tasks.default_timeout_minutes',
            'platform.api_request_timeout_seconds',
            'container_manager.stop_timeout_seconds',
            'agent.max_iterations',
            'tools.shell_exec_timeout_seconds',
            'workspace.clone_timeout_seconds',
            'capture.push_retries',
            'platform.log_flush_interval_ms',
            'agent.history_max_messages'
          )
        ORDER BY config_key ASC`,
      [TENANT_ID],
    );

    expect(rows.rows).toEqual([
      { config_key: 'agent.history_max_messages', config_value: '200' },
      { config_key: 'agent.max_iterations', config_value: '800' },
      { config_key: 'capture.push_retries', config_value: '5' },
      { config_key: 'container_manager.stop_timeout_seconds', config_value: '60' },
      { config_key: 'platform.api_request_timeout_seconds', config_value: '60' },
      { config_key: 'platform.log_flush_interval_ms', config_value: '750' },
      { config_key: 'tasks.default_timeout_minutes', config_value: '180' },
      { config_key: 'tools.shell_exec_timeout_seconds', config_value: '300' },
      { config_key: 'workspace.clone_timeout_seconds', config_value: '600' },
    ]);
  }, 120_000);
});

async function createMigrationSubsetDir(files: string[]) {
  const sourceDir = migrationsDirFromTest();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-default-scale-migrations-'));
  await Promise.all(
    files.map(async (file) =>
      fs.copyFile(path.join(sourceDir, file), path.join(tempDir, file)),
    ),
  );
  return tempDir;
}

function migrationsDirFromTest() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(currentDir, '..', '..', '..', 'src', 'db', 'migrations');
}
