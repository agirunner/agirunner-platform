/**
 * OT-3: Pipeline State Derivation
 *
 * Tests that the orchestrator correctly derives pipeline state from
 * the aggregate of task states:
 * - All completed → pipeline "completed"
 * - Any failed → pipeline "failed"
 * - Any running → pipeline "active"
 * - All cancelled → pipeline "cancelled"
 * - Mixed terminal states derive correctly
 *
 * Test plan ref: Section 3, OT-3
 * FR refs: FR-076, FR-077, FR-078
 */

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { createTestTenant, type TenantContext } from './tenant.js';
import { pollPipelineUntil, pollUntilValue } from './poll.js';
import { linearTemplateSchema, fanOutTemplateSchema } from './templates.js';

async function drainRemainingTasks(ctx: TenantContext): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    const claimed = await ctx.workerClient.claimTask({
      agent_id: ctx.agentId,
      worker_id: ctx.workerId,
      capabilities: ['llm-api'],
    });
    if (!claimed) break;
    await ctx.agentClient.startTask(claimed.id, { agent_id: ctx.agentId });
    await ctx.agentClient.completeTask(claimed.id, { result: 'test' });
  }
}

/**
 * Test: All completed → pipeline "completed"
 */
async function testAllCompleted(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctx.adminClient.createTemplate({
    name: 'OT3-all-completed',
    slug: `ot3-complete-${Date.now()}`,
    schema: linearTemplateSchema(),
  });

  const pipeline = await ctx.adminClient.createPipeline({
    template_id: template.id,
    name: 'OT3-all-completed',
  });

  await drainRemainingTasks(ctx);

  const finalPipeline = await pollPipelineUntil(
    ctx.adminClient,
    pipeline.id,
    ['completed'],
    10_000,
  );
  if (finalPipeline.state !== 'completed') {
    throw new Error(`Expected pipeline "completed", got "${finalPipeline.state}"`);
  }
  validations.push('all_completed:pipeline_completed');

  return validations;
}

/**
 * Test: Any failed → pipeline "failed"
 */
async function testAnyFailed(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctx.adminClient.createTemplate({
    name: 'OT3-any-failed',
    slug: `ot3-fail-${Date.now()}`,
    schema: linearTemplateSchema(),
  });

  const pipeline = await ctx.adminClient.createPipeline({
    template_id: template.id,
    name: 'OT3-any-failed',
  });

  const firstTask = (pipeline.tasks ?? []).find((t) => t.state === 'ready');
  if (!firstTask) throw new Error('No ready task found');

  await ctx.workerClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api'],
  });
  await ctx.agentClient.startTask(firstTask.id, { agent_id: ctx.agentId });
  await ctx.agentClient.failTask(firstTask.id, {
    message: 'Intentional failure',
    source: 'test',
  });

  const finalPipeline = await pollPipelineUntil(ctx.adminClient, pipeline.id, ['failed'], 10_000);
  if (finalPipeline.state !== 'failed') {
    throw new Error(`Expected pipeline "failed", got "${finalPipeline.state}"`);
  }
  validations.push('any_failed:pipeline_failed');

  return validations;
}

/**
 * Test: Any running → pipeline "active"
 */
async function testAnyRunning(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctx.adminClient.createTemplate({
    name: 'OT3-any-running',
    slug: `ot3-running-${Date.now()}`,
    schema: linearTemplateSchema(),
  });

  const pipeline = await ctx.adminClient.createPipeline({
    template_id: template.id,
    name: 'OT3-any-running',
  });

  const claim = await ctx.workerClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api'],
  });

  if (!claim) throw new Error('No task claimable for running-state scenario');
  await ctx.agentClient.startTask(claim.id, { agent_id: ctx.agentId });

  const activePipeline = await pollUntilValue(
    () => ctx.adminClient.getPipeline(pipeline.id),
    (value) => value.state === 'active',
    {
      timeoutMs: 10_000,
      intervalMs: 250,
      label: `OT-3 any-running pipeline ${pipeline.id} active`,
    },
  );
  if (activePipeline.state !== 'active') {
    throw new Error(
      `Expected pipeline "active" while a task is running, got "${activePipeline.state}"`,
    );
  }

  await ctx.agentClient.completeTask(claim.id, { result: 'running-state-check-complete' });
  await drainRemainingTasks(ctx);

  validations.push('any_running:pipeline_active');
  return validations;
}

/**
 * Test: Mixed terminal states derive to "failed" (completed + cancelled).
 */
async function testMixedTerminalDerivation(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctx.adminClient.createTemplate({
    name: 'OT3-mixed-terminal',
    slug: `ot3-mixed-${Date.now()}`,
    schema: fanOutTemplateSchema(),
  });

  const pipeline = await ctx.adminClient.createPipeline({
    template_id: template.id,
    name: 'OT3-mixed-terminal',
  });

  const rootClaim = await ctx.workerClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api'],
  });
  if (!rootClaim) throw new Error('Expected initial root task to be claimable');

  await ctx.agentClient.startTask(rootClaim.id, { agent_id: ctx.agentId });
  await ctx.agentClient.completeTask(rootClaim.id, { result: 'root-complete' });

  const branchClaim = await pollUntilValue(
    () =>
      ctx.workerClient.claimTask({
        agent_id: ctx.agentId,
        worker_id: ctx.workerId,
        capabilities: ['llm-api'],
      }),
    (value) => value !== null,
    {
      timeoutMs: 10_000,
      intervalMs: 250,
      label: `OT-3 mixed-terminal branch task claim for pipeline ${pipeline.id}`,
    },
  );
  if (!branchClaim) throw new Error('Expected a branch task to be claimable');

  await ctx.agentClient.startTask(branchClaim.id, { agent_id: ctx.agentId });
  await ctx.agentClient.completeTask(branchClaim.id, { result: 'branch-complete' });

  const afterBranch = await pollUntilValue(
    () => ctx.adminClient.getPipeline(pipeline.id),
    (value) => (value.tasks ?? []).some((task) => task.state === 'ready'),
    {
      timeoutMs: 10_000,
      intervalMs: 250,
      label: `OT-3 mixed-terminal ready sibling for pipeline ${pipeline.id}`,
    },
  );
  const readySibling = (afterBranch.tasks ?? []).find((task) => task.state === 'ready');
  if (!readySibling) throw new Error('Expected one ready sibling task for mixed terminal scenario');

  await ctx.adminClient.cancelTask(readySibling.id);

  const terminalPipeline = await pollPipelineUntil(
    ctx.adminClient,
    pipeline.id,
    ['failed'],
    10_000,
  );
  if (terminalPipeline.state !== 'failed') {
    throw new Error(
      `Expected mixed terminal pipeline to derive "failed", got "${terminalPipeline.state}"`,
    );
  }

  const taskStates = (terminalPipeline.tasks ?? []).map((task) => task.state);
  if (!taskStates.includes('completed') || !taskStates.includes('cancelled')) {
    throw new Error(`Expected mixed completed/cancelled tasks, got: ${taskStates.join(', ')}`);
  }

  validations.push('mixed_terminal:derived_failed');
  return validations;
}

/**
 * Test: Cancel pipeline → all non-terminal tasks cancelled
 */
async function testAllCancelled(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctx.adminClient.createTemplate({
    name: 'OT3-cancelled',
    slug: `ot3-cancel-${Date.now()}`,
    schema: fanOutTemplateSchema(),
  });

  const pipeline = await ctx.adminClient.createPipeline({
    template_id: template.id,
    name: 'OT3-cancelled',
  });

  await ctx.adminClient.cancelPipeline(pipeline.id);

  const finalPipeline = await pollPipelineUntil(
    ctx.adminClient,
    pipeline.id,
    ['cancelled'],
    10_000,
  );
  if (finalPipeline.state !== 'cancelled') {
    throw new Error(`Expected pipeline "cancelled", got "${finalPipeline.state}"`);
  }

  const allCancelled = (finalPipeline.tasks ?? []).every((t) => t.state === 'cancelled');
  if (!allCancelled) {
    const states = (finalPipeline.tasks ?? []).map((t) => `${t.id}:${t.state}`);
    throw new Error(`Not all tasks cancelled: ${states.join(', ')}`);
  }
  validations.push('all_cancelled:pipeline_and_tasks_cancelled');

  return validations;
}

/**
 * Main OT-3 runner.
 */
export async function runOt3PipelineState(live: LiveContext): Promise<ScenarioExecutionResult> {
  const ctx = await createTestTenant('ot3-state');
  const allValidations: string[] = [];

  try {
    allValidations.push(...(await testAllCompleted(ctx)));
    allValidations.push(...(await testAnyFailed(ctx)));
    allValidations.push(...(await testAnyRunning(ctx)));
    allValidations.push(...(await testMixedTerminalDerivation(ctx)));
    allValidations.push(...(await testAllCancelled(ctx)));
  } finally {
    await ctx.cleanup();
  }

  return {
    name: 'ot3-pipeline-state',
    costUsd: 0,
    artifacts: [],
    validations: allValidations,
    screenshots: [],
  };
}
