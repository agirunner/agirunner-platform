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

describe.runIf(canRunIntegration)('workflow stage gate migration compatibility', () => {
  let db: TestDatabase | null = null;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    if (db) {
      await stopTestDatabase(db);
    }
  });

  it('adds requested_by_work_item_id when workflow_stage_gates exists in the legacy shape', async () => {
    expect(db).not.toBeNull();
    const pool = db!.pool;

    await pool.query('DROP TABLE workflow_stage_gates');
    await pool.query(`
      CREATE TABLE workflow_stage_gates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        workflow_id uuid NOT NULL REFERENCES workflows(id),
        stage_id uuid NOT NULL REFERENCES workflow_stages(id),
        stage_name text NOT NULL,
        request_summary text NOT NULL,
        recommendation text,
        concerns jsonb NOT NULL DEFAULT '[]'::jsonb,
        key_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
        status text NOT NULL,
        requested_by_type text NOT NULL,
        requested_by_id text,
        requested_at timestamptz NOT NULL DEFAULT now(),
        decision_feedback text,
        decided_by_type text,
        decided_by_id text,
        decided_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE UNIQUE INDEX uq_workflow_stage_gates_active
        ON workflow_stage_gates (tenant_id, workflow_id, stage_id)
        WHERE status = 'awaiting_approval'
    `);
    await pool.query(`
      CREATE INDEX idx_workflow_stage_gates_queue
        ON workflow_stage_gates (tenant_id, status, requested_at ASC)
    `);
    await pool.query(`
      CREATE INDEX idx_workflow_stage_gates_workflow_stage
        ON workflow_stage_gates (tenant_id, workflow_id, stage_id, requested_at DESC)
    `);
    await pool.query(`
      DELETE FROM schema_migrations
       WHERE filename = '0046_workflow_stage_gate_request_anchor.sql'
    `);

    await runMigrations(
      pool,
      await createMigrationSubsetDir(['0046_workflow_stage_gate_request_anchor.sql']),
    );

    const columnResult = await pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'workflow_stage_gates'
          AND column_name = 'requested_by_work_item_id'`,
    );

    expect(columnResult.rows).toEqual([{ column_name: 'requested_by_work_item_id' }]);
  }, 120_000);
});

async function createMigrationSubsetDir(files: string[]) {
  const sourceDir = migrationsDirFromTest();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-stage-gates-migrations-'));
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
