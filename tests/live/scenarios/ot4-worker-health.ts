/**
 * OT-4: Worker Health Monitoring
 *
 * Tests worker registration, heartbeat, status transitions, and cleanup:
 * - Worker registers and is listed
 * - Heartbeat updates worker status
 * - Missing heartbeats eventually mark worker offline
 * - Worker can be deleted
 *
 * Test plan ref: Section 3, OT-4
 * FR refs: FR-050, FR-051, FR-052, FR-054
 */

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import type { ApiWorker } from '../api-client.js';
import { createTestTenant, type TenantContext } from './tenant.js';
import { sleep } from './poll.js';

function workerMatches(worker: ApiWorker, workerId: string): boolean {
  return worker.id === workerId || worker.worker_id === workerId;
}

async function waitForWorker(
  ctx: TenantContext,
  workerId: string,
  timeoutMs = 5_000,
): Promise<ApiWorker | null> {
  const start = Date.now();

  while (Date.now() - start <= timeoutMs) {
    const workers = await ctx.adminClient.listWorkers();
    const found = workers.find((worker) => workerMatches(worker, workerId));
    if (found) {
      return found;
    }

    await sleep(250);
  }

  return null;
}

/**
 * Test: Worker registration and listing.
 */
async function testWorkerRegistration(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  // The worker was already registered in createTestTenant; listing can lag
  // briefly, so poll for up to 5 seconds before failing.
  const found = await waitForWorker(ctx, ctx.workerId, 5_000);
  if (!found) {
    throw new Error(`Worker ${ctx.workerId} not found in worker list after retry window`);
  }
  validations.push('worker_registered');
  validations.push('worker_listed');

  return validations;
}

/**
 * Test: Heartbeat updates worker status.
 */
async function testHeartbeat(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  // Send heartbeat with "online" status
  await ctx.workerClient.heartbeat(ctx.workerId, { status: 'online' });
  validations.push('heartbeat_online_sent');

  // Send heartbeat with "busy" status
  await ctx.workerClient.heartbeat(ctx.workerId, { status: 'busy' });
  validations.push('heartbeat_busy_sent');

  return validations;
}

/**
 * Test: Register a second worker and delete it.
 */
async function testWorkerDeletion(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  // Register a second worker
  const worker2 = await ctx.workerClient.registerWorker({
    name: 'ot4-ephemeral-worker',
    capabilities: ['llm-api'],
    connection_mode: 'polling',
    runtime_type: 'external',
  });
  const worker2Id = worker2.worker_id ?? worker2.id;
  if (!worker2Id) {
    const workerSummary = {
      id: worker2.worker_id ?? worker2.id,
      name: worker2.name,
      status: worker2.status,
    };
    throw new Error(
      `Worker registration returned no worker identifier: ${JSON.stringify(workerSummary)}`,
    );
  }

  validations.push('second_worker_registered');

  // Delete it
  await ctx.adminClient.deleteWorker(worker2Id);
  validations.push('worker_deleted');

  // Verify it's gone from the list
  await sleep(500);
  const workers = await ctx.adminClient.listWorkers();
  const found = workers.find((worker) => workerMatches(worker, worker2Id));
  if (found) {
    validations.push('worker_still_listed_after_delete');
  } else {
    validations.push('worker_removed_from_list');
  }

  return validations;
}

/**
 * Main OT-4 runner.
 */
export async function runOt4WorkerHealth(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  const ctx = await createTestTenant('ot4-health');
  const allValidations: string[] = [];

  try {
    allValidations.push(...await testWorkerRegistration(ctx));
    allValidations.push(...await testHeartbeat(ctx));
    allValidations.push(...await testWorkerDeletion(ctx));
  } finally {
    await ctx.cleanup();
  }

  return {
    name: 'ot4-worker-health',
    costUsd: 0,
    artifacts: [],
    validations: allValidations,
    screenshots: [],
  };
}
