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
import type { ApiWorkflow, ApiTask } from '../api-client.js';
import { createTestTenant, type TenantContext } from './tenant.js';
import { pollWorkflowUntil, pollTaskUntil } from './poll.js';
import { diamondTemplateSchema, fanOutTemplateSchema, linearTemplateSchema } from './templates.js';

/**
 * Helper: claim one of the expected tasks without mutating non-target tasks.
 */
async function claimExpectedTask(
  ctx: TenantContext,
  expectedTaskIds: string[],
  workflowId: string,
): Promise<ApiTask> {
  const claimed = await ctx.workerClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api'],
    workflow_id: workflowId,
  });

  if (!claimed) {
    throw new Error(`Could not claim any task (expected one of: ${expectedTaskIds.join(', ')})`);
  }

  if (!expectedTaskIds.includes(claimed.id)) {
    throw new Error(
      `Claimed unexpected task ${claimed.id}; expected one of: ${expectedTaskIds.join(', ')}`,
    );
  }

  return claimed;
}

/**
 * Helper: manually complete one expected task via claim → start → complete.
 */
async function manuallyCompleteTask(
  ctx: TenantContext,
  expectedTaskIds: string | string[],
  workflowId: string,
): Promise<string> {
  const expected = Array.isArray(expectedTaskIds) ? expectedTaskIds : [expectedTaskIds];
  const claimed = await claimExpectedTask(ctx, expected, workflowId);

  // Start/Complete must be authenticated as the registered agent.
  await ctx.agentClient.startTask(claimed.id, { agent_id: ctx.agentId });
  await ctx.agentClient.completeTask(claimed.id, { result: 'test-completed' });
  return claimed.id;
}

/**
 * Helper: manually fail an expected task via claim → start → fail.
 */
async function manuallyFailTask(ctx: TenantContext, taskId: string, workflowId: string): Promise<void> {
  const claimed = await claimExpectedTask(ctx, [taskId], workflowId);

  await ctx.agentClient.startTask(claimed.id, { agent_id: ctx.agentId });
  await ctx.agentClient.failTask(claimed.id, {
    message: 'Intentional test failure',
    source: 'test-harness',
  });
}

/**
 * Find a task by its template-level role or position within the workflow.
 */
function findTask(workflow: ApiWorkflow, titleContains: string): ApiTask {
  const tasks = workflow.tasks ?? [];
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

  const workflow = await ctx.adminClient.createWorkflow({
    template_id: template.id,
    name: 'OT1-linear-test',
  });

  const taskA = findTask(workflow, 'Task A');
  const taskB = findTask(workflow, 'Task B');
  const taskC = findTask(workflow, 'Task C');

  // A should be ready, B and C pending
  if (taskA.state !== 'ready') throw new Error(`A: expected ready, got ${taskA.state}`);
  if (taskB.state !== 'pending') throw new Error(`B: expected pending, got ${taskB.state}`);
  if (taskC.state !== 'pending') throw new Error(`C: expected pending, got ${taskC.state}`);
  validations.push('linear:initial_states_correct');

  // Complete A → B should become ready
  await manuallyCompleteTask(ctx, taskA.id, workflow.id);
  const afterA = await pollTaskUntil(ctx.adminClient, taskB.id, ['ready'], 10_000);
  if (afterA.state !== 'ready')
    throw new Error(`B after A complete: expected ready, got ${afterA.state}`);
  validations.push('linear:A_complete_cascades_B');

  // Complete B → C should become ready
  await manuallyCompleteTask(ctx, taskB.id, workflow.id);
  const afterB = await pollTaskUntil(ctx.adminClient, taskC.id, ['ready'], 10_000);
  if (afterB.state !== 'ready')
    throw new Error(`C after B complete: expected ready, got ${afterB.state}`);
  validations.push('linear:B_complete_cascades_C');

  // Complete C → workflow should be completed
  await manuallyCompleteTask(ctx, taskC.id, workflow.id);
  const finalWorkflow = await pollWorkflowUntil(
    ctx.adminClient,
    workflow.id,
    ['completed'],
    10_000,
  );
  if (finalWorkflow.state !== 'completed') {
    throw new Error(`Workflow: expected completed, got ${finalWorkflow.state}`);
  }
  validations.push('linear:workflow_completed');

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

  const workflow = await ctx.adminClient.createWorkflow({
    template_id: template.id,
    name: 'OT1-fanout-test',
  });

  const taskA = findTask(workflow, 'Task A');
  const taskB = findTask(workflow, 'Task B');
  const taskC = findTask(workflow, 'Task C');

  if (taskB.state !== 'pending') throw new Error(`B: expected pending, got ${taskB.state}`);
  if (taskC.state !== 'pending') throw new Error(`C: expected pending, got ${taskC.state}`);
  validations.push('fanout:initial_states_correct');

  // Complete A → both B and C should be ready
  await manuallyCompleteTask(ctx, taskA.id, workflow.id);
  const bAfter = await pollTaskUntil(ctx.adminClient, taskB.id, ['ready'], 10_000);
  const cAfter = await pollTaskUntil(ctx.adminClient, taskC.id, ['ready'], 10_000);
  if (bAfter.state !== 'ready')
    throw new Error(`B after fanout: expected ready, got ${bAfter.state}`);
  if (cAfter.state !== 'ready')
    throw new Error(`C after fanout: expected ready, got ${cAfter.state}`);
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

  const workflow = await ctx.adminClient.createWorkflow({
    template_id: template.id,
    name: 'OT1-diamond-test',
  });

  const taskA = findTask(workflow, 'Task A');
  const taskB = findTask(workflow, 'Task B');
  const taskC = findTask(workflow, 'Task C');
  const taskD = findTask(workflow, 'Task D');

  if (taskD.state !== 'pending') throw new Error(`D: expected pending, got ${taskD.state}`);
  validations.push('diamond:initial_states_correct');

  // Complete A → B and C ready, D still pending
  await manuallyCompleteTask(ctx, taskA.id, workflow.id);
  const bAfterA = await pollTaskUntil(ctx.adminClient, taskB.id, ['ready'], 10_000);
  const cAfterA = await pollTaskUntil(ctx.adminClient, taskC.id, ['ready'], 10_000);
  const dAfterA = await ctx.adminClient.getTask(taskD.id);
  if (bAfterA.state !== 'ready') throw new Error(`B: expected ready, got ${bAfterA.state}`);
  if (cAfterA.state !== 'ready') throw new Error(`C: expected ready, got ${cAfterA.state}`);
  if (dAfterA.state !== 'pending')
    throw new Error(`D after A only: expected pending, got ${dAfterA.state}`);
  validations.push('diamond:A_unblocks_B_C_not_D');

  // Complete one branch (B or C) → D still pending (fan-in not satisfied yet)
  const firstCompletedBranch = await manuallyCompleteTask(ctx, [taskB.id, taskC.id], workflow.id);
  const dAfterFirstBranch = await ctx.adminClient.getTask(taskD.id);
  if (dAfterFirstBranch.state !== 'pending') {
    throw new Error(
      `D after first branch (${firstCompletedBranch}) only: expected pending, got ${dAfterFirstBranch.state}`,
    );
  }
  validations.push('diamond:first_branch_complete_D_still_pending');

  // Complete remaining branch → D ready (fan-in satisfied)
  const remainingBranchId = firstCompletedBranch === taskB.id ? taskC.id : taskB.id;
  await manuallyCompleteTask(ctx, remainingBranchId, workflow.id);
  const dAfterBothBranches = await pollTaskUntil(ctx.adminClient, taskD.id, ['ready'], 10_000);
  if (dAfterBothBranches.state !== 'ready') {
    throw new Error(`D after both branches: expected ready, got ${dAfterBothBranches.state}`);
  }
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

  const workflow = await ctx.adminClient.createWorkflow({
    template_id: template.id,
    name: 'OT1-failed-dep-test',
  });

  const taskA = findTask(workflow, 'Task A');
  const taskB = findTask(workflow, 'Task B');

  // Fail A
  await manuallyFailTask(ctx, taskA.id, workflow.id);

  // Workflow should be failed
  const p = await pollWorkflowUntil(ctx.adminClient, workflow.id, ['failed'], 10_000);
  if (p.state !== 'failed') {
    throw new Error(`Workflow expected failed, got ${p.state}`);
  }
  validations.push('failed_dep:workflow_failed');

  // B should remain pending (never becomes ready)
  const bAfter = await ctx.adminClient.getTask(taskB.id);
  if (bAfter.state === 'ready') {
    throw new Error('B became ready after A failed — dependency not enforced');
  }
  validations.push('failed_dep:B_stays_blocked');

  return validations;
}

/**
 * Main OT-1 runner: executes all cascade sub-tests.
 */
export async function runOt1DependencyCascade(live: LiveContext): Promise<ScenarioExecutionResult> {
  const ctx = await createTestTenant('ot1-cascade');
  const allValidations: string[] = [];

  try {
    allValidations.push(...(await testLinearChain(ctx)));
    allValidations.push(...(await testFanOut(ctx)));
    allValidations.push(...(await testDiamond(ctx)));
    allValidations.push(...(await testFailedDependency(ctx)));
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
