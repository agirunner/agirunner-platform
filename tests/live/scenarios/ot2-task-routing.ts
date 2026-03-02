/**
 * OT-2: Task Routing & Capability Matching
 *
 * Tests the platform's capability-based task routing:
 * - Exact match: worker with matching capabilities claims task
 * - Superset match: worker with superset capabilities claims task
 * - No match: claim must fail when capabilities don't match
 * - Priority ordering: higher priority tasks claimed first
 * - FIFO within priority: older tasks claimed first at same priority
 * - One-claim limit: worker can only hold one claimed task at a time
 *
 * Test plan ref: Section 3, OT-2
 * FR refs: FR-012a, FR-025, FR-026
 */

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { createTestTenant, type TenantContext } from './tenant.js';
import { sleep } from './poll.js';

async function completeTask(ctx: TenantContext, taskId: string): Promise<void> {
  await ctx.agentClient.startTask(taskId, { agent_id: ctx.agentId });
  await ctx.agentClient.completeTask(taskId, { result: 'test' });
}

/**
 * Test: Exact capability match — worker claims task with matching capabilities.
 */
async function testExactMatch(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const task = await ctx.workerClient.createTask({
    title: 'OT2-exact-match',
    type: 'code',
    role: 'developer',
    capabilities_required: ['llm-api', 'role:developer'],
  });

  const claimed = await ctx.workerClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api', 'role:developer'],
  });

  if (!claimed) throw new Error('Claim returned null for exact-match task');
  if (claimed.id !== task.id) throw new Error(`Claimed wrong task: ${claimed.id} vs ${task.id}`);

  await completeTask(ctx, task.id);
  validations.push('exact_match:claimed');

  return validations;
}

/**
 * Test: Superset capability match — worker with extra capabilities can claim.
 */
async function testSupersetMatch(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const task = await ctx.workerClient.createTask({
    title: 'OT2-superset-match',
    type: 'code',
    role: 'developer',
    capabilities_required: ['llm-api'],
  });

  const claimed = await ctx.workerClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api', 'role:developer', 'lang:typescript'],
  });

  if (!claimed) throw new Error('Claim returned null for superset-match task');
  if (claimed.id !== task.id) throw new Error(`Claimed wrong task for superset match: ${claimed.id} vs ${task.id}`);

  await completeTask(ctx, task.id);
  validations.push('superset_match:claimed');

  return validations;
}

/**
 * Test: No capability match — claim MUST return null.
 */
async function testNoMatch(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  await ctx.workerClient.createTask({
    title: 'OT2-no-match',
    type: 'code',
    role: 'developer',
    capabilities_required: ['devops', 'kubernetes'],
  });

  const claimed = await ctx.workerClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api', 'role:developer'],
  });

  if (claimed) {
    throw new Error(`Expected no-match claim to return null, but claimed task ${claimed.id}`);
  }

  validations.push('no_match:claim_returns_null');
  return validations;
}

/**
 * Test: Priority ordering — critical task claimed before low task.
 */
async function testPriorityOrdering(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const lowPri = await ctx.workerClient.createTask({
    title: 'OT2-low-priority',
    type: 'code',
    role: 'developer',
    priority: 'low',
    capabilities_required: ['llm-api'],
  });

  await sleep(100);

  const highPri = await ctx.workerClient.createTask({
    title: 'OT2-high-priority',
    type: 'code',
    role: 'developer',
    priority: 'critical',
    capabilities_required: ['llm-api'],
  });

  const claimed = await ctx.workerClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api'],
  });

  if (!claimed) throw new Error('Claim returned null for priority test');
  if (claimed.id !== highPri.id) {
    throw new Error(`Priority ordering violated: expected ${highPri.id}, got ${claimed.id} (low was ${lowPri.id})`);
  }

  await completeTask(ctx, claimed.id);

  const second = await ctx.workerClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api'],
  });
  if (!second || second.id !== lowPri.id) {
    throw new Error(`Expected second claim to return low-priority task ${lowPri.id}, got ${second?.id ?? 'null'}`);
  }
  await completeTask(ctx, second.id);

  validations.push('priority:high_claimed_first');
  return validations;
}

/**
 * Test: FIFO within same priority — older task claimed first.
 */
async function testFifoWithinPriority(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const first = await ctx.workerClient.createTask({
    title: 'OT2-fifo-first',
    type: 'code',
    role: 'developer',
    priority: 'normal',
    capabilities_required: ['llm-api'],
  });

  await sleep(1000);

  const second = await ctx.workerClient.createTask({
    title: 'OT2-fifo-second',
    type: 'code',
    role: 'developer',
    priority: 'normal',
    capabilities_required: ['llm-api'],
  });

  const claimed = await ctx.workerClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api'],
  });

  if (!claimed) throw new Error('Claim returned null for FIFO test');
  if (claimed.id !== first.id) {
    throw new Error(`FIFO violated: expected first task ${first.id}, got ${claimed.id} (second is ${second.id})`);
  }

  await completeTask(ctx, claimed.id);

  const next = await ctx.workerClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api'],
  });
  if (!next || next.id !== second.id) {
    throw new Error(`Expected second FIFO claim to return ${second.id}, got ${next?.id ?? 'null'}`);
  }
  await completeTask(ctx, next.id);

  validations.push('fifo:older_claimed_first');
  return validations;
}

/**
 * Test: One-claim limit — an agent cannot hold a second claimed task.
 */
async function testOneClaimLimit(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const first = await ctx.workerClient.createTask({
    title: 'OT2-one-claim-first',
    type: 'code',
    capabilities_required: ['llm-api'],
  });

  const second = await ctx.workerClient.createTask({
    title: 'OT2-one-claim-second',
    type: 'code',
    capabilities_required: ['llm-api'],
  });

  const claimedFirst = await ctx.workerClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api'],
  });

  if (!claimedFirst || claimedFirst.id !== first.id) {
    throw new Error(`Expected first claim to return ${first.id}, got ${claimedFirst?.id ?? 'null'}`);
  }

  try {
    await ctx.workerClient.claimTask({
      agent_id: ctx.agentId,
      worker_id: ctx.workerId,
      capabilities: ['llm-api'],
    });
    throw new Error('Expected second claim attempt to fail while first task is still claimed');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(' returned 409:')) {
      throw new Error(`Expected one-claim limit to return 409, got: ${message}`);
    }
  }

  await completeTask(ctx, first.id);

  const claimedSecond = await ctx.workerClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api'],
  });

  if (!claimedSecond || claimedSecond.id !== second.id) {
    throw new Error(`Expected second task ${second.id} to be claimable after completion, got ${claimedSecond?.id ?? 'null'}`);
  }

  await completeTask(ctx, second.id);
  validations.push('one_claim_limit:enforced');

  return validations;
}

/**
 * Main OT-2 runner: executes all routing sub-tests.
 */
export async function runOt2TaskRouting(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  const ctx = await createTestTenant('ot2-routing');
  const allValidations: string[] = [];

  try {
    allValidations.push(...await testExactMatch(ctx));
    allValidations.push(...await testSupersetMatch(ctx));
    allValidations.push(...await testNoMatch(ctx));
    allValidations.push(...await testPriorityOrdering(ctx));
    allValidations.push(...await testFifoWithinPriority(ctx));
    allValidations.push(...await testOneClaimLimit(ctx));
  } finally {
    await ctx.cleanup();
  }

  return {
    name: 'ot2-task-routing',
    costUsd: 0,
    artifacts: [],
    validations: allValidations,
    screenshots: [],
  };
}
