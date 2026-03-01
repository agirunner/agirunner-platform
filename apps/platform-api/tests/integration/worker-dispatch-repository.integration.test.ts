import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { claimTaskForWorker } from '../../src/services/worker-dispatch-repository.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

describe('worker dispatch repository integration', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  it('allows only one worker to claim a ready task under concurrent race', async () => {
    const taskId = randomUUID();
    const workerA = randomUUID();
    const workerB = randomUUID();

    await db.pool.query(
      `INSERT INTO workers (id, tenant_id, name, runtime_type, connection_mode, status, capabilities, heartbeat_interval_seconds)
       VALUES
         ($1,$3,'worker-a','openclaw','websocket','online',ARRAY['typescript'],30),
         ($2,$3,'worker-b','openclaw','websocket','online',ARRAY['typescript'],30)`,
      [workerA, workerB, tenantId],
    );

    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, state)
       VALUES ($1,$2,'race-task','code','ready')`,
      [taskId, tenantId],
    );

    const [claimA, claimB] = await Promise.all([
      claimTaskForWorker(db.pool, taskId, tenantId, workerA),
      claimTaskForWorker(db.pool, taskId, tenantId, workerB),
    ]);

    const successfulClaims = [claimA, claimB].filter((claim) => claim !== null);
    expect(successfulClaims).toHaveLength(1);

    const task = await db.pool.query('SELECT state, assigned_worker_id FROM tasks WHERE tenant_id = $1 AND id = $2', [
      tenantId,
      taskId,
    ]);

    expect(task.rows[0].state).toBe('claimed');
    expect([workerA, workerB]).toContain(task.rows[0].assigned_worker_id);
  });
});
