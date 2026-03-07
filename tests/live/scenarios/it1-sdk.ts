/**
 * IT-1: SDK Integration Tests
 *
 * Tests the @agirunner/sdk package against the live Platform API:
 * - Client creation and authentication
 * - Task CRUD via SDK client
 * - Task claim and complete lifecycle
 * - Workflow creation and retrieval
 * - Error handling for invalid inputs
 *
 * Test plan ref: Section 4, IT-1
 * FR refs: FR-300–FR-310 (SDK)
 */

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { PlatformApiClient } from '../../../packages/sdk/src/client.js';
import { createTestTenant, type TenantContext } from './tenant.js';
import { loadConfig } from '../config.js';
import { linearTemplateSchema } from './templates.js';
import { LiveApiClient } from '../api-client.js';

const config = loadConfig();

/**
 * Test: SDK client can list tasks.
 */
async function testSdkListTasks(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const client = new PlatformApiClient({
    baseUrl: config.apiBaseUrl,
    accessToken: ctx.agentKey,
  });

  const result = await client.listTasks({ page: 1, per_page: 10 });
  if (!Array.isArray(result.data)) throw new Error('SDK listTasks returned no data array');

  const metadata = (result as unknown as { meta?: Record<string, unknown>; pagination?: Record<string, unknown> }).meta
    ?? (result as unknown as { pagination?: Record<string, unknown> }).pagination;

  if (!metadata || typeof metadata !== 'object') {
    throw new Error('SDK listTasks returned no pagination metadata');
  }

  validations.push('sdk_list_tasks_ok');

  return validations;
}

/**
 * Test: SDK client can create and retrieve a task.
 */
async function testSdkTaskCrud(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const client = new PlatformApiClient({
    baseUrl: config.apiBaseUrl,
    accessToken: ctx.workerKey,
  });

  const created = await client.createTask({
    title: 'IT1-sdk-task',
    type: 'analysis',
    description: 'SDK integration test task',
    capabilities_required: ['sdk-crud-only'],
  });

  if (!created.id) throw new Error('SDK createTask returned no id');
  if (created.title !== 'IT1-sdk-task') {
    throw new Error(`Unexpected title: ${created.title}`);
  }
  validations.push('sdk_create_task_ok');

  // Retrieve by ID using agent key
  const agentClient = new PlatformApiClient({
    baseUrl: config.apiBaseUrl,
    accessToken: ctx.agentKey,
  });

  const retrieved = await agentClient.getTask(created.id);
  if (retrieved.id !== created.id) throw new Error('SDK getTask returned wrong task');
  validations.push('sdk_get_task_ok');

  return validations;
}

/**
 * Test: SDK client can claim and complete a task.
 */
async function testSdkClaimComplete(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const workerClient = new PlatformApiClient({
    baseUrl: config.apiBaseUrl,
    accessToken: ctx.workerKey,
  });

  const agentClient = new PlatformApiClient({
    baseUrl: config.apiBaseUrl,
    accessToken: ctx.agentKey,
  });

  // Create task
  const task = await workerClient.createTask({
    title: 'IT1-lifecycle',
    type: 'code',
    capabilities_required: ['llm-api'],
  });
  validations.push('sdk_lifecycle_created');

  // Claim
  const claimed = await agentClient.claimTask({
    agent_id: ctx.agentId,
    worker_id: ctx.workerId,
    capabilities: ['llm-api'],
  });
  if (!claimed) throw new Error('SDK claim returned null');
  if (claimed.id !== task.id) throw new Error(`SDK claimed wrong task: ${claimed.id}`);
  validations.push('sdk_lifecycle_claimed');

  // Start via API using agent token for lifecycle identity
  const rawClient = new LiveApiClient(config.apiBaseUrl, ctx.agentKey);
  await rawClient.startTask(task.id, { agent_id: ctx.agentId });
  validations.push('task_started_via_api');

  // Complete via SDK
  const completed = await agentClient.completeTask(task.id, { result: 'sdk-test' });
  if (completed.state !== 'completed') {
    throw new Error(`Expected completed, got ${completed.state}`);
  }
  validations.push('sdk_lifecycle_completed');

  return validations;
}

/**
 * Test: SDK can create and get a workflow.
 */
async function testSdkWorkflow(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  // Need admin client to create template (SDK doesn't have template ops)
  const template = await ctx.adminClient.createTemplate({
    name: 'IT1-sdk-workflow',
    slug: `it1-sdk-pip-${Date.now()}`,
    schema: linearTemplateSchema(),
  });

  const sdkClient = new PlatformApiClient({
    baseUrl: config.apiBaseUrl,
    accessToken: ctx.adminKey,
  });

  const workflow = await sdkClient.createWorkflow({
    template_id: template.id,
    name: 'IT1-sdk-workflow-test',
  });
  if (!workflow.id) throw new Error('SDK createWorkflow returned no id');
  validations.push('sdk_create_workflow_ok');

  const retrieved = await sdkClient.getWorkflow(workflow.id);
  if (retrieved.id !== workflow.id) throw new Error('SDK getWorkflow returned wrong workflow');
  validations.push('sdk_get_workflow_ok');

  return validations;
}

/**
 * Test: SDK error handling for invalid operations.
 */
async function testSdkErrorHandling(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const client = new PlatformApiClient({
    baseUrl: config.apiBaseUrl,
    accessToken: ctx.agentKey,
  });

  try {
    await client.getTask('00000000-0000-0000-0000-000000000000');
    throw new Error('Expected error for non-existent task');
  } catch (error) {
    if (error instanceof Error && error.message.includes('Expected error')) {
      throw error;
    }
    validations.push('sdk_not_found_error_ok');
  }

  return validations;
}

/**
 * Main IT-1 runner.
 */
export async function runIt1Sdk(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  const ctx = await createTestTenant('it1-sdk');
  const allValidations: string[] = [];

  try {
    allValidations.push(...await testSdkListTasks(ctx));
    allValidations.push(...await testSdkTaskCrud(ctx));
    allValidations.push(...await testSdkClaimComplete(ctx));
    allValidations.push(...await testSdkWorkflow(ctx));
    allValidations.push(...await testSdkErrorHandling(ctx));
  } finally {
    await ctx.cleanup();
  }

  return {
    name: 'it1-sdk',
    costUsd: 0,
    artifacts: [],
    validations: allValidations,
    screenshots: [],
  };
}
