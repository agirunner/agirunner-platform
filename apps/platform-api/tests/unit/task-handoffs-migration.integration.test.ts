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
} from '../helpers/postgres.js';

const canRunIntegration = isContainerRuntimeAvailable();

describe.runIf(canRunIntegration)('task handoff migration compatibility', () => {
  let db: TestDatabase | null = null;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    if (db) {
      await stopTestDatabase(db);
    }
  });

  it('adds task_rework_count when task_handoffs already exists in the legacy shape', async () => {
    expect(db).not.toBeNull();
    const pool = db!.pool;

    await pool.query('DROP TABLE task_handoffs');
    await pool.query(`
      CREATE TABLE task_handoffs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        work_item_id uuid REFERENCES workflow_work_items(id) ON DELETE CASCADE,
        task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        request_id text,
        role text NOT NULL,
        team_name text,
        stage_name text,
        sequence integer NOT NULL DEFAULT 0,
        summary text NOT NULL,
        completion text NOT NULL DEFAULT 'full',
        changes jsonb NOT NULL DEFAULT '[]'::jsonb,
        decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
        remaining_items jsonb NOT NULL DEFAULT '[]'::jsonb,
        blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
        review_focus text[] NOT NULL DEFAULT '{}'::text[],
        known_risks text[] NOT NULL DEFAULT '{}'::text[],
        successor_context text,
        role_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        artifact_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT task_handoffs_completion_check
          CHECK (completion IN ('full', 'partial', 'blocked'))
      )
    `);
    await pool.query(`DELETE FROM schema_migrations WHERE filename = '0034_task_handoffs_rework_backfill.sql'`);

    await runMigrations(pool, await createMigrationSubsetDir(['0034_task_handoffs_rework_backfill.sql']));

    const columnResult = await pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'task_handoffs'
          AND column_name = 'task_rework_count'`,
    );
    const indexResult = await pool.query<{ indexdef: string }>(
      `SELECT indexdef
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'idx_task_handoffs_task_attempt'`,
    );

    expect(columnResult.rows).toEqual([{ column_name: 'task_rework_count' }]);
    expect(indexResult.rows[0]?.indexdef ?? '').toContain('(task_id, task_rework_count)');
  }, 120_000);
});

async function createMigrationSubsetDir(files: string[]) {
  const sourceDir = migrationsDirFromTest();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-handoffs-migrations-'));
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
