/**
 * Integration test for FR-752: Built-in agent replaceable by external agent.
 *
 * Proves that when an external worker registers with capabilities that cover a
 * built-in worker's capabilities, the dispatch logic prefers the external
 * worker over the built-in.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { claimTaskForWorker, findDispatchCandidateWorkers } from '../../src/services/worker-dispatch-repository.js';
import { selectWorkerForDispatch } from '../../src/services/worker-dispatch-service.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

describe('FR-752: external worker preferred over built-in for dispatch', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  it('external worker with matching capabilities gets tasks instead of built-in worker', async () => {
    const builtInWorkerId = randomUUID();
    const externalWorkerId = randomUUID();
    const taskId = randomUUID();

    // Register a built-in (internal) worker
    await db.pool.query(
      `INSERT INTO workers (id, tenant_id, name, runtime_type, connection_mode, status, capabilities, heartbeat_interval_seconds)
       VALUES ($1, $2, 'built-in-worker', 'internal', 'websocket', 'online', ARRAY['general','typescript'], 30)`,
      [builtInWorkerId, tenantId],
    );

    // Register an external worker with the same capabilities
    await db.pool.query(
      `INSERT INTO workers (id, tenant_id, name, runtime_type, connection_mode, status, capabilities, heartbeat_interval_seconds)
       VALUES ($1, $2, 'external-worker', 'external', 'websocket', 'online', ARRAY['general','typescript'], 30)`,
      [externalWorkerId, tenantId],
    );

    // Create a ready task requiring those capabilities
    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, state, capabilities_required)
       VALUES ($1, $2, 'pref-test-task', 'code', 'ready', ARRAY['typescript'])`,
      [taskId, tenantId],
    );

    // Both workers are connected and available
    const connectedWorkerIds = [builtInWorkerId, externalWorkerId];

    // Find candidates from the DB
    const candidates = await findDispatchCandidateWorkers(
      db.pool,
      tenantId,
      connectedWorkerIds,
      ['typescript'],
    );

    expect(candidates.length).toBeGreaterThanOrEqual(2);

    // Use the dispatch selection logic — it must prefer the external worker
    const selectedId = selectWorkerForDispatch(candidates);
    expect(selectedId).toBe(externalWorkerId);
  });

  it('falls back to built-in worker when no external worker is available', async () => {
    const builtInWorkerId = randomUUID();
    const taskId = randomUUID();

    await db.pool.query(
      `INSERT INTO workers (id, tenant_id, name, runtime_type, connection_mode, status, capabilities, heartbeat_interval_seconds)
       VALUES ($1, $2, 'only-built-in', 'internal', 'websocket', 'online', ARRAY['special-cap'], 30)`,
      [builtInWorkerId, tenantId],
    );

    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, state, capabilities_required)
       VALUES ($1, $2, 'fallback-task', 'code', 'ready', ARRAY['special-cap'])`,
      [taskId, tenantId],
    );

    const candidates = await findDispatchCandidateWorkers(
      db.pool,
      tenantId,
      [builtInWorkerId],
      ['special-cap'],
    );

    expect(candidates.length).toBe(1);

    // When only built-in is available, it should still be selected
    const selectedId = selectWorkerForDispatch(candidates);
    expect(selectedId).toBe(builtInWorkerId);
  });
});
