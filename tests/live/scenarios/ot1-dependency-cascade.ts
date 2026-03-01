/**
 * OT-1: Dependency Cascade Tests
 *
 * Tests the orchestrator's dependency resolution logic independently
 * of any LLM worker. The test harness manually completes tasks via the
 * API and verifies that the orchestrator correctly cascades state.
 *
 * Covers: linear chain, fan-out, fan-in, diamond, failed dependency.
 *
 * Test plan ref: Section 3, OT-1
 * FR refs: FR-002, FR-013
 */

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import type { ApiPipeline, ApiTask } from '../api-client.js';
import { LiveApiClient } from '../api-client.js';
import { loadConfig } from '../config.js';
import { createTestTenant, type TenantContext } from './tenant.js';
import { pollTaskUntil, sleep } from './poll.js';
import {
  diamondTemplateSchema,
  fanOutTemplateSchema,
  linearTemplateSchema,
} from './templates.js';

const config = loadConfig();

/**
 * Helper: manually complete a task via claim → start → complete.
 */
async function manuallyCompleteTask(
  ctx: TenantContext,
  taskId: string,
): Promise<void> {
  // Claim
  const claimed = await ctx.agentClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api'],
  });
  if (!claimed) throw new Error(`Could not claim any task (expected ${taskId})`);
  if (claimed.id !== taskId) {
    // We claimed a different task — complete it and try again
    await ctx.agentClient.startTask(claimed.id, { agent_id: ctx.agentId });
    await ctx.agentClient.completeTask(claimed.id, { result: 'auto-completed' });
    return manuallyCompleteTask(ctx, taskId);
  }

  // Start
  await ctx.agentClient.startTask(taskId, { agent_id: ctx.agentId });
  // Complete
  await ctx.agentClient.completeTask(taskId, { result: 'test-completed' });
}

/**
 * Helper: manually fail a task via claim → start → fail.
 */
async function manuallyFailTask(
  ctx: TenantContext,
  taskId: string,
): Promise<void> {
  await ctx.agentClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api'],
  });
  await ctx.agentClient.startTask(taskId, { agent_id: ctx.agentId });
  await ctx.agentClient.failTask(taskId, {
    message: 'Intentional test failure',
    source: 'test-harness',
  });
}

/**
 * Find a task by its template-level role or position within the pipeline.
 */
function findTask(pipeline: ApiPipeline, titleContains: string): ApiTask {
  const tasks = pipeline.tasks ?? [];
  const match = tasks.find((t) => t.title.includes(titleContains));
  if (!match) {
    throw new Error(
      `No task containing "${titleContains}" found. Available: ${tasks.map((t) => t.title).join(', ')}`,
    );
  }
  return match;
}

/**
 * Linear chain test: A → B → C
 *
 * Complete A → B becomes ready
 * Complete B → C becomes ready
 */
async function testLinearChain(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctx.adminClient.createTemplate({
    name: 'OT1-linear',
    slug: `ot1-linear-${Date.now()}`,
    schema: linearTemplateSchema(),
  });

  const pipeline = await ctx.adminClient.createPipeline({
    template_id: template.id,
    name: 'OT1-linear-test',
  });

  const taskA = findTask(pipeline, 'Task A');
  const taskB = findTask(pipeline, 'Task B');
  const taskC = findTask(pipeline, 'Task C');

  // A should be ready, B and C pending
  if (taskA.state !== 'ready') throw new Error(`A: expected ready, got ${taskA.state}`);
  if (taskB.state !== 'pending') throw new Error(`B: expected pending, got ${taskB.state}`);
  if (taskC.state !== 'pending') throw new Error(`C: expected pending, got ${taskC.state}`);
  validations.push('linear:initial_states_correct');

  // Complete A → B should become ready
  await manuallyCompleteTask(ctx, taskA.id);
  await sleep(1000);
  const afterA = await ctx.adminClient.getTask(taskB.id);
  if (afterA.state !== 'ready') throw new Error(`B after A complete: expected ready, got ${afterA.state}`);
  validations.push('linear:A_complete_cascades_B');

  // Complete B → C should become ready
  await manuallyCompleteTask(ctx, taskB.id);
  await sleep(1000);
  const afterB = await ctx.adminClient.getTask(taskC.id);
  if (afterB.state !== 'ready') throw new Error(`C after B complete: expected ready, got ${afterB.state}`);
  validations.push('linear:B_complete_cascades_C');

  // Complete C → pipeline should be completed
  await manuallyCompleteTask(ctx, taskC.id);
  await sleep(1000);
  const finalPipeline = await ctx.adminClient.getPipeline(pipeline.id);
  if (finalPipeline.state !== 'completed') {
    throw new Error(`Pipeline: expected completed, got ${finalPipeline.state}`);
  }
  validations.push('linear:pipeline_completed');

  return validations;
}

/**
 * Fan-out test: A → B, A → C
 *
 * Complete A → both B and C become ready simultaneously
 */
async function testFanOut(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctx.adminClient.createTemplate({
    name: 'OT1-fanout',
    slug: `ot1-fanout-${Date.now()}`,
    schema: fanOutTemplateSchema(),
  });

  const pipeline = await ctx.adminClient.createPipeline({
    template_id: template.id,
    name: 'OT1-fanout-test',
  });

  const taskA = findTask(pipeline, 'Task A');
  const taskB = findTask(pipeline, 'Task B');
  const taskC = findTask(pipeline, 'Task C');

  if (taskB.state !== 'pending') throw new Error(`B: expected pending, got ${taskB.state}`);
  if (taskC.state !== 'pending') throw new Error(`C: expected pending, got ${taskC.state}`);
  validations.push('fanout:initial_states_correct');

  // Complete A → both B and C should be ready
  await manuallyCompleteTask(ctx, taskA.id);
  await sleep(1000);
  const bAfter = await ctx.adminClient.getTask(taskB.id);
  const cAfter = await ctx.adminClient.getTask(taskC.id);
  if (bAfter.state !== 'ready') throw new Error(`B after fanout: expected ready, got ${bAfter.state}`);
  if (cAfter.state !== 'ready') throw new Error(`C after fanout: expected ready, got ${cAfter.state}`);
  validations.push('fanout:A_complete_unblocks_B_and_C');

  return validations;
}

/**
 * Diamond test: A → B, A → C, B+C → D
 *
 * Complete A → B and C ready
 * Complete B → D still pending (C not done)
 * Complete C → D ready
 */
async function testDiamond(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctx.adminClient.createTemplate({
    name: 'OT1-diamond',
    slug: `ot1-diamond-${Date.now()}`,
    schema: diamondTemplateSchema(),
  });

  const pipeline = await ctx.adminClient.createPipeline({
    template_id: template.id,
    name: 'OT1-diamond-test',
  });

  const taskA = findTask(pipeline, 'Task A');
  const taskB = findTask(pipeline, 'Task B');
  const taskC = findTask(pipeline, 'Task C');
  const taskD = findTask(pipeline, 'Task D');

  if (taskD.state !== 'pending') throw new Error(`D: expected pending, got ${taskD.state}`);
  validations.push('diamond:initial_states_correct');

  // Complete A → B and C ready, D still pending
  await manuallyCompleteTask(ctx, taskA.id);
  await sleep(1000);
  const bAfterA = await ctx.adminClient.getTask(taskB.id);
  const cAfterA = await ctx.adminClient.getTask(taskC.id);
  const dAfterA = await ctx.adminClient.getTask(taskD.id);
  if (bAfterA.state !== 'ready') throw new Error(`B: expected ready, got ${bAfterA.state}`);
  if (cAfterA.state !== 'ready') throw new Error(`C: expected ready, got ${cAfterA.state}`);
  if (dAfterA.state !== 'pending') throw new Error(`D after A only: expected pending, got ${dAfterA.state}`);
  validations.push('diamond:A_unblocks_B_C_not_D');

  // Complete B → D still pending (C not done)
  await manuallyCompleteTask(ctx, taskB.id);
  await sleep(1000);
  const dAfterB = await ctx.adminClient.getTask(taskD.id);
  if (dAfterB.state !== 'pending') throw new Error(`D after B only: expected pending, got ${dAfterB.state}`);
  validations.push('diamond:B_complete_D_still_pending');

  // Complete C → D ready (fan-in satisfied)
  await manuallyCompleteTask(ctx, taskC.id);
  await sleep(1000);
  const dAfterC = await ctx.adminClient.getTask(taskD.id);
  if (dAfterC.state !== 'ready') throw new Error(`D after B+C: expected ready, got ${dAfterC.state}`);
  validations.push('diamond:fan_in_unblocks_D');

  return validations;
}

/**
 * Failed dependency test: A fails → B stays pending
 */
async function testFailedDependency(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctx.adminClient.createTemplate({
    name: 'OT1-failed-dep',
    slug: `ot1-fail-dep-${Date.now()}`,
    schema: linearTemplateSchema(),
  });

  const pipeline = await ctx.adminClient.createPipeline({
    template_id: template.id,
    name: 'OT1-failed-dep-test',
  });

  const taskA = findTask(pipeline, 'Task A');
  const taskB = findTask(pipeline, 'Task B');

  // Fail A
  await manuallyFailTask(ctx, taskA.id);
  await sleep(1000);

  // B should remain pending (never becomes ready)
  const bAfter = await ctx.adminClient.getTask(taskB.id);
  if (bAfter.state === 'ready') {
    throw new Error('B became ready after A failed — dependency not enforced');
  }
  validations.push('failed_dep:B_stays_blocked');

  // Pipeline should be failed
  const p = await ctx.adminClient.getPipeline(pipeline.id);
  if (p.state !== 'failed') {
    throw new Error(`Pipeline expected failed, got ${p.state}`);
  }
  validations.push('failed_dep:pipeline_failed');

  return validations;
}

/**
 * Main OT-1 runner: executes all cascade sub-tests.
 */
export async function runOt1DependencyCascade(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  const ctx = await createTestTenant('ot1-cascade');
  const allValidations: string[] = [];

  try {
    allValidations.push(...await testLinearChain(ctx));
    allValidations.push(...await testFanOut(ctx));
    allValidations.push(...await testDiamond(ctx));
    allValidations.push(...await testFailedDependency(ctx));
  } finally {
    await ctx.cleanup();
  }

  return {
    name: 'ot1-dependency-cascade',
    costUsd: 0,
    artifacts: [],
    validations: allValidations,
    screenshots: [],
  };
}
