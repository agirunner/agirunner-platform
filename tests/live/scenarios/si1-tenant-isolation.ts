/**
 * SI-1: Tenant Isolation Tests
 *
 * Verifies that data created in one tenant is not accessible from another:
 * - Templates in tenant A are invisible from tenant B
 * - Tasks in tenant A cannot be claimed/written from tenant B (404)
 * - Pipelines in tenant A are invisible from tenant B
 * - Workers in tenant A are invisible from tenant B
 * - Deactivated tenant requests are forbidden (403)
 * - SSE stream only emits events for the authenticated tenant
 *
 * Test plan ref: Section 5, SI-1
 * FR refs: FR-100, FR-101, FR-102 (multi-tenant isolation)
 */

import pg from 'pg';

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { loadConfig } from '../config.js';
import { createTestTenant, type TenantContext } from './tenant.js';
import { linearTemplateSchema } from './templates.js';

const config = loadConfig();

interface SseCursor {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  buffer: string;
}

function parseStatusCodeFromError(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/ returned (\d+):/);
  return match ? Number(match[1]) : null;
}

async function expectHttpStatus(
  label: string,
  expectedStatus: number,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
    throw new Error(`Expected ${label} to fail with HTTP ${expectedStatus}, but request succeeded`);
  } catch (error) {
    const status = parseStatusCodeFromError(error);
    if (status !== expectedStatus) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Expected ${label} to fail with HTTP ${expectedStatus}, got ${status ?? 'unknown'} (${message})`);
    }
  }
}

async function readSseEvent(cursor: SseCursor, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  while (true) {
    const sep = cursor.buffer.indexOf('\n\n');
    if (sep !== -1) {
      const rawEvent = cursor.buffer.slice(0, sep);
      cursor.buffer = cursor.buffer.slice(sep + 2);

      const lines = rawEvent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith(':'));

      const dataLines = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim());

      if (dataLines.length === 0) {
        continue;
      }

      try {
        return JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
      } catch {
        continue;
      }
    }

    const readResult = await Promise.race([cursor.reader.read(), timeout]);
    if (!readResult || !('done' in readResult)) {
      return null;
    }

    if (readResult.done) {
      return null;
    }

    cursor.buffer += new TextDecoder().decode(readResult.value, { stream: true });
  }
}

async function waitForEvent(
  cursor: SseCursor,
  predicate: (event: Record<string, unknown>) => boolean,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const event = await readSseEvent(cursor, remaining);
    if (!event) {
      return null;
    }
    if (predicate(event)) {
      return event;
    }
  }

  return null;
}

/**
 * Test: Template isolation — tenant A's templates invisible to tenant B.
 */
async function testTemplateIsolation(
  ctxA: TenantContext,
  ctxB: TenantContext,
): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctxA.adminClient.createTemplate({
    name: 'SI1-tenant-a-template',
    slug: `si1-a-${Date.now()}`,
    schema: linearTemplateSchema(),
  });
  validations.push('tenant_a_template_created');

  const bTemplate = await ctxB.agentClient.getTemplate(template.id).catch(() => null);
  if (bTemplate === null) {
    validations.push('template_isolation_enforced');
  } else {
    throw new Error('Tenant B can see Tenant A template — isolation breach');
  }

  return validations;
}

/**
 * Test: Task isolation — tenant A's tasks cannot be claimed from tenant B.
 */
async function testTaskIsolation(
  ctxA: TenantContext,
  ctxB: TenantContext,
): Promise<string[]> {
  const validations: string[] = [];

  const task = await ctxA.workerClient.createTask({
    title: 'SI1-tenant-a-task',
    type: 'code',
    capabilities_required: ['llm-api'],
  });
  validations.push('tenant_a_task_created');

  const claimed = await ctxB.agentClient.claimTask({
    agent_id: ctxB.agentId,
    worker_id: ctxB.workerId,
    capabilities: ['llm-api'],
  });

  if (claimed && claimed.id === task.id) {
    throw new Error('Tenant B claimed Tenant A task — isolation breach');
  }
  validations.push('task_isolation_enforced');

  return validations;
}

/**
 * Test: Cross-tenant write attempts return 404.
 */
async function testCrossTenantWrite404(
  ctxA: TenantContext,
  ctxB: TenantContext,
): Promise<string[]> {
  const validations: string[] = [];

  const task = await ctxA.workerClient.createTask({
    title: 'SI1-cross-tenant-write',
    type: 'code',
  });

  await expectHttpStatus('cross-tenant task complete', 404, () =>
    ctxB.agentClient.completeTask(task.id, { result: 'should-fail-cross-tenant' }),
  );

  validations.push('cross_tenant_write_404');
  return validations;
}

/**
 * Test: Pipeline isolation — tenant A's pipelines invisible to tenant B.
 */
async function testPipelineIsolation(
  ctxA: TenantContext,
  ctxB: TenantContext,
): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctxA.adminClient.createTemplate({
    name: 'SI1-pipeline-isolation',
    slug: `si1-pip-${Date.now()}`,
    schema: linearTemplateSchema(),
  });

  const pipeline = await ctxA.adminClient.createPipeline({
    template_id: template.id,
    name: 'SI1-pipeline-a',
  });
  validations.push('tenant_a_pipeline_created');

  const bPipeline = await ctxB.agentClient
    .getPipeline(pipeline.id)
    .catch(() => null);

  if (bPipeline === null) {
    validations.push('pipeline_isolation_enforced');
  } else {
    throw new Error('Tenant B can see Tenant A pipeline — isolation breach');
  }

  return validations;
}

/**
 * Test: Worker isolation — tenant A's workers invisible to tenant B.
 */
async function testWorkerIsolation(
  ctxA: TenantContext,
  ctxB: TenantContext,
): Promise<string[]> {
  const validations: string[] = [];

  const bWorkers = await ctxB.adminClient.listWorkers();
  const foundInB = bWorkers.find((w) => w.worker_id === ctxA.workerId);

  if (foundInB) {
    throw new Error('Tenant B can see Tenant A worker — isolation breach');
  }
  validations.push('worker_isolation_enforced');

  return validations;
}

/**
 * Test: Deactivated tenant requests return 403.
 */
async function testDeactivatedTenant403(ctxA: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const pool = new pg.Pool({ connectionString: config.postgresUrl });
  try {
    await pool.query('UPDATE tenants SET is_active = false WHERE id = $1', [ctxA.tenantId]);
  } finally {
    await pool.end();
  }

  await expectHttpStatus('deactivated tenant listTasks', 403, () => ctxA.agentClient.listTasks());
  validations.push('deactivated_tenant_403');

  return validations;
}

/**
 * Test: SSE isolation — tenant B must not receive tenant A events.
 */
async function testSseIsolation(
  ctxA: TenantContext,
  ctxB: TenantContext,
): Promise<string[]> {
  const validations: string[] = [];

  const streamA = await ctxA.agentClient.openEventStream({ event_type: 'task.created' });
  const streamB = await ctxB.agentClient.openEventStream({ event_type: 'task.created' });

  const cursorA: SseCursor = { reader: streamA.reader, buffer: '' };
  const cursorB: SseCursor = { reader: streamB.reader, buffer: '' };

  try {
    const task = await ctxA.workerClient.createTask({
      title: `SI1-sse-${Date.now()}`,
      type: 'code',
    });

    const aSawEvent = await waitForEvent(
      cursorA,
      (event) => event.type === 'task.created' && event.entity_id === task.id,
      8_000,
    );
    if (!aSawEvent) {
      throw new Error('Tenant A SSE stream did not receive its own task.created event');
    }

    const bSawLeak = await waitForEvent(
      cursorB,
      (event) => event.type === 'task.created' && event.entity_id === task.id,
      2_500,
    );
    if (bSawLeak) {
      throw new Error(`Tenant B SSE stream received tenant A event: ${JSON.stringify(bSawLeak)}`);
    }

    validations.push('sse_isolation_enforced');
  } finally {
    streamA.abort();
    streamB.abort();
  }

  return validations;
}

/**
 * Main SI-1 runner.
 */
export async function runSi1TenantIsolation(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  const ctxA = await createTestTenant('si1-tenant-a');
  const ctxB = await createTestTenant('si1-tenant-b');
  const allValidations: string[] = [];

  try {
    allValidations.push(...await testTemplateIsolation(ctxA, ctxB));
    allValidations.push(...await testTaskIsolation(ctxA, ctxB));
    allValidations.push(...await testCrossTenantWrite404(ctxA, ctxB));
    allValidations.push(...await testPipelineIsolation(ctxA, ctxB));
    allValidations.push(...await testWorkerIsolation(ctxA, ctxB));
    allValidations.push(...await testSseIsolation(ctxA, ctxB));
    allValidations.push(...await testDeactivatedTenant403(ctxA));
  } finally {
    await ctxA.cleanup();
    await ctxB.cleanup();
  }

  return {
    name: 'si1-tenant-isolation',
    costUsd: 0,
    artifacts: [],
    validations: allValidations,
    screenshots: [],
  };
}
