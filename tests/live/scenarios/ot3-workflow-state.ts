/**
 * OT-3: Workflow State Derivation
 *
 * Tests that the orchestrator correctly derives workflow state from
 * the aggregate of task states:
 * - All completed → workflow "completed"
 * - Any failed → workflow "failed"
 * - Any running → workflow "active"
 * - All cancelled → workflow "cancelled"
 * - Mixed terminal states derive correctly
 *
 * Test plan ref: Section 3, OT-3
 * FR refs: FR-076, FR-077, FR-078
 */

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { createTestTenant, type TenantContext } from './tenant.js';
import { pollWorkflowUntil, pollUntilValue } from './poll.js';
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
 * Test: All completed → workflow "completed"
 */
async function testAllCompleted(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctx.adminClient.createTemplate({
    name: 'OT3-all-completed',
    slug: `ot3-complete-${Date.now()}`,
    schema: linearTemplateSchema(),
  });

  const workflow = await ctx.adminClient.createWorkflow({
    template_id: template.id,
    name: 'OT3-all-completed',
  });

  await drainRemainingTasks(ctx);

  const finalWorkflow = await pollWorkflowUntil(
    ctx.adminClient,
    workflow.id,
    ['completed'],
    10_000,
  );
  if (finalWorkflow.state !== 'completed') {
    throw new Error(`Expected workflow "completed", got "${finalWorkflow.state}"`);
  }
  validations.push('all_completed:workflow_completed');

  return validations;
}

/**
 * Test: Any failed → workflow "failed"
 */
async function testAnyFailed(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctx.adminClient.createTemplate({
    name: 'OT3-any-failed',
    slug: `ot3-fail-${Date.now()}`,
    schema: linearTemplateSchema(),
  });

  const workflow = await ctx.adminClient.createWorkflow({
    template_id: template.id,
    name: 'OT3-any-failed',
  });

  const firstTask = (workflow.tasks ?? []).find((t) => t.state === 'ready');
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

  const finalWorkflow = await pollWorkflowUntil(ctx.adminClient, workflow.id, ['failed'], 10_000);
  if (finalWorkflow.state !== 'failed') {
    throw new Error(`Expected workflow "failed", got "${finalWorkflow.state}"`);
  }
  validations.push('any_failed:workflow_failed');

  return validations;
}

/**
 * Test: Any running → workflow "active"
 */
async function testAnyRunning(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctx.adminClient.createTemplate({
    name: 'OT3-any-running',
    slug: `ot3-running-${Date.now()}`,
    schema: linearTemplateSchema(),
  });

  const workflow = await ctx.adminClient.createWorkflow({
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

  const activeWorkflow = await pollUntilValue(
    () => ctx.adminClient.getWorkflow(workflow.id),
    (value) => value.state === 'active',
    {
      timeoutMs: 10_000,
      intervalMs: 250,
      label: `OT-3 any-running workflow ${workflow.id} active`,
    },
  );
  if (activeWorkflow.state !== 'active') {
    throw new Error(
      `Expected workflow "active" while a task is running, got "${activeWorkflow.state}"`,
    );
  }

  await ctx.agentClient.completeTask(claim.id, { result: 'running-state-check-complete' });
  await drainRemainingTasks(ctx);

  validations.push('any_running:workflow_active');
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

  const workflow = await ctx.adminClient.createWorkflow({
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
      label: `OT-3 mixed-terminal branch task claim for workflow ${workflow.id}`,
    },
  );
  if (!branchClaim) throw new Error('Expected a branch task to be claimable');

  await ctx.agentClient.startTask(branchClaim.id, { agent_id: ctx.agentId });
  await ctx.agentClient.completeTask(branchClaim.id, { result: 'branch-complete' });

  const afterBranch = await pollUntilValue(
    () => ctx.adminClient.getWorkflow(workflow.id),
    (value) => (value.tasks ?? []).some((task) => task.state === 'ready'),
    {
      timeoutMs: 10_000,
      intervalMs: 250,
      label: `OT-3 mixed-terminal ready sibling for workflow ${workflow.id}`,
    },
  );
  const readySibling = (afterBranch.tasks ?? []).find((task) => task.state === 'ready');
  if (!readySibling) throw new Error('Expected one ready sibling task for mixed terminal scenario');

  await ctx.adminClient.cancelTask(readySibling.id);

  const terminalWorkflow = await pollWorkflowUntil(
    ctx.adminClient,
    workflow.id,
    ['failed'],
    10_000,
  );
  if (terminalWorkflow.state !== 'failed') {
    throw new Error(
      `Expected mixed terminal workflow to derive "failed", got "${terminalWorkflow.state}"`,
    );
  }

  const taskStates = (terminalWorkflow.tasks ?? []).map((task) => task.state);
  if (!taskStates.includes('completed') || !taskStates.includes('cancelled')) {
    throw new Error(`Expected mixed completed/cancelled tasks, got: ${taskStates.join(', ')}`);
  }

  validations.push('mixed_terminal:derived_failed');
  return validations;
}

/**
 * Test: Cancel workflow → all non-terminal tasks cancelled
 */
async function testAllCancelled(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const template = await ctx.adminClient.createTemplate({
    name: 'OT3-cancelled',
    slug: `ot3-cancel-${Date.now()}`,
    schema: fanOutTemplateSchema(),
  });

  const workflow = await ctx.adminClient.createWorkflow({
    template_id: template.id,
    name: 'OT3-cancelled',
  });

  await ctx.adminClient.cancelWorkflow(workflow.id);

  const finalWorkflow = await pollWorkflowUntil(
    ctx.adminClient,
    workflow.id,
    ['cancelled'],
    10_000,
  );
  if (finalWorkflow.state !== 'cancelled') {
    throw new Error(`Expected workflow "cancelled", got "${finalWorkflow.state}"`);
  }

  const allCancelled = (finalWorkflow.tasks ?? []).every((t) => t.state === 'cancelled');
  if (!allCancelled) {
    const states = (finalWorkflow.tasks ?? []).map((t) => `${t.id}:${t.state}`);
    throw new Error(`Not all tasks cancelled: ${states.join(', ')}`);
  }
  validations.push('all_cancelled:workflow_and_tasks_cancelled');

  return validations;
}

/**
 * Main OT-3 runner.
 */
export async function runOt3WorkflowState(live: LiveContext): Promise<ScenarioExecutionResult> {
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
    name: 'ot3-workflow-state',
    costUsd: 0,
    artifacts: [],
    validations: allValidations,
    screenshots: [],
  };
}
