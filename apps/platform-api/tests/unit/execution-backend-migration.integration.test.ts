import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/db/migrations/run-migrations.js';
import {
  isContainerRuntimeAvailable,
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from './helpers/postgres.js';

const canRunIntegration = isContainerRuntimeAvailable();

describe.runIf(canRunIntegration)('execution backend migration compatibility', () => {
  let db: TestDatabase | null = null;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    if (db) {
      await stopTestDatabase(db);
    }
  });

  it('adds tasks.execution_backend and backfills existing rows from is_orchestrator_task', async () => {
    expect(db).not.toBeNull();
    const pool = db!.pool;

    await pool.query('DROP INDEX IF EXISTS idx_tasks_execution_backend');
    await pool.query(
      `ALTER TABLE tasks
         DROP COLUMN IF EXISTS execution_backend`,
    );
    await pool.query(
      `ALTER TABLE execution_logs
         DROP COLUMN IF EXISTS execution_backend,
         DROP COLUMN IF EXISTS tool_owner`,
    );
    await pool.query(
      `ALTER TABLE live_container_inventory
         DROP COLUMN IF EXISTS execution_backend`,
    );
    await pool.query(
      `DELETE FROM schema_migrations
        WHERE filename = '0047_runtime_owned_loops_and_task_owned_sandboxes.sql'`,
    );

    await pool.query(
      `INSERT INTO tenants (id, name, slug)
       VALUES
         ('00000000-0000-0000-0000-000000000001', 'Tenant One', 'tenant-one')
       ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO tasks (id, tenant_id, title, is_orchestrator_task)
       VALUES
         ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'Orchestrator task', true),
         ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'Specialist task', false)`,
    );

    await runMigrations(
      pool,
      await createMigrationSubsetDir(['0047_runtime_owned_loops_and_task_owned_sandboxes.sql']),
    );

    const columnResult = await pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tasks'
          AND column_name = 'execution_backend'`,
    );
    const rows = await pool.query<{ id: string; execution_backend: string }>(
      `SELECT id, execution_backend
         FROM tasks
        WHERE id IN (
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222'
        )
        ORDER BY id`,
    );

    expect(columnResult.rows).toEqual([{ column_name: 'execution_backend' }]);
    expect(rows.rows).toEqual([
      { id: '11111111-1111-1111-1111-111111111111', execution_backend: 'runtime_only' },
      { id: '22222222-2222-2222-2222-222222222222', execution_backend: 'runtime_plus_task' },
    ]);
  }, 120_000);
});

async function createMigrationSubsetDir(files: string[]) {
  const sourceDir = migrationsDirFromTest();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'execution-backend-migrations-'));
  await Promise.all(
    files.map(async (file) =>
      fs.copyFile(path.join(sourceDir, file), path.join(tempDir, file)),
    ),
  );
  return tempDir;
}

function migrationsDirFromTest() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(currentDir, '..', '..', 'src', 'db', 'migrations');
}
