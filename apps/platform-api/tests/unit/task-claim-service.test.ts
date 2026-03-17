import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  configureProviderSecretEncryptionKey,
  storeOAuthToken,
  storeProviderSecret,
} from '../../src/lib/oauth-crypto.js';
import { TaskClaimService } from '../../src/services/task-claim-service.js';

configureProviderSecretEncryptionKey('test-encryption-key');

const identity = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'agent' as const,
  ownerType: 'agent' as const,
  ownerId: 'agent-1',
  keyPrefix: 'agent-key',
};

const defaultResolvedRoleConfig = {
  provider: {
    name: 'OpenAI',
    providerId: 'provider-default',
    providerType: 'openai',
    authMode: 'api_key',
    apiKeySecretRef: 'secret:OPENAI_API_KEY',
    baseUrl: 'https://api.openai.test/v1',
  },
  model: {
    modelId: 'gpt-5',
    contextWindow: null,
    maxOutputTokens: 128000,
    endpointType: 'responses',
    reasoningConfig: null,
  },
  reasoningConfig: { reasoning_effort: 'low' },
};

function createClient(executionMode: 'specialist' | 'orchestrator') {
  return {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('UPDATE tasks')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT * FROM agents')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'agent-1',
            worker_id: null,
            current_task_id: null,
            metadata: { execution_mode: executionMode },
          }],
        };
      }
      if (sql.includes('SELECT tasks.* FROM tasks')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }),
    release: vi.fn(),
  };
}

function createService(client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }) {
  const pool = {
    connect: vi.fn(async () => client),
  };
  return new TaskClaimService({
    pool: pool as never,
    eventService: { emit: vi.fn() } as never,
    toTaskResponse: (task) => task,
    getTaskContext: vi.fn(async () => ({})),
    resolveRoleConfig: vi.fn(async () => defaultResolvedRoleConfig),
    claimHandleSecret: 'test-claim-handle-secret',
  });
}

function runtimeDefaultQueryResult(sql: string, params?: unknown[]) {
  if (!sql.includes('FROM runtime_defaults')) {
    return null;
  }
  const key = params?.[1];
  if (key === 'agent.max_iterations') {
    return { rowCount: 1, rows: [{ config_value: '100' }] };
  }
  if (key === 'agent.llm_max_retries') {
    return { rowCount: 1, rows: [{ config_value: '5' }] };
  }
  return { rowCount: 0, rows: [] };
}

describe('TaskClaimService', () => {
  it('limits specialist agents to non-orchestrator tasks', async () => {
    const client = createClient('specialist');
    const service = createService(client);

    await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    });

    const taskSelectSql = String(client.query.mock.calls[3]?.[0] ?? '');
    expect(taskSelectSql).toContain('tasks.is_orchestrator_task = false');
  });

  it('limits orchestrator agents to orchestrator tasks', async () => {
    const client = createClient('orchestrator');
    const service = createService(client);

    await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding', 'orchestrator'],
    });

    const taskSelectSql = String(client.query.mock.calls[3]?.[0] ?? '');
    expect(taskSelectSql).toContain('tasks.is_orchestrator_task = true');
  });

  it('filters candidate tasks by playbook_id when provided', async () => {
    const client = createClient('specialist');
    const service = createService(client);

    await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
      playbook_id: 'playbook-1',
    });

    const taskSelectSql = String(client.query.mock.calls[3]?.[0] ?? '');
    expect(taskSelectSql).toContain('workflows.playbook_id');
    const params = (client.query.mock.calls[3]?.[1] ?? []) as unknown[];
    expect(params).toContain('playbook-1');
  });

  it('attaches the effective loop contract to claimed specialist tasks', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-loop-contract',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {},
              metadata: {},
              is_orchestrator_task: false,
              max_iterations: null,
              llm_max_retries: null,
            }],
          };
        }
        if (sql.includes("FROM runtime_defaults")) {
          const key = params?.[1];
          if (key === 'agent.max_iterations') {
            return { rowCount: 1, rows: [{ config_value: '100' }] };
          }
          if (key === 'agent.llm_max_retries') {
            return { rowCount: 1, rows: [{ config_value: '5' }] };
          }
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-loop-contract',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              state: 'claimed',
              role: 'developer',
              project_id: null,
              role_config: {},
              metadata: {},
              is_orchestrator_task: false,
              max_iterations: null,
              llm_max_retries: null,
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT') && sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return { rowCount: 0, rows: [] };
        }
        const runtimeDefault = runtimeDefaultQueryResult(sql, params);
        if (runtimeDefault) {
          return runtimeDefault;
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => defaultResolvedRoleConfig),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    });

    expect(task?.max_iterations).toBe(100);
    expect(task?.llm_max_retries).toBe(5);
    expect(task?.loop_mode).toBe('reactive');
  });

  it('fails task claim when the effective loop contract is missing', async () => {
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-missing-loop-contract',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {},
              metadata: {},
              is_orchestrator_task: false,
              max_iterations: null,
              llm_max_retries: null,
            }],
          };
        }
        if (sql.includes("FROM runtime_defaults")) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => defaultResolvedRoleConfig),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    await expect(service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    })).rejects.toThrow('Missing runtime default "agent.max_iterations"');
  });

  it('skips ready tasks that are blocked by playbook parallelism caps', async () => {
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: 'task-blocked',
                workflow_id: 'wf-1',
                work_item_id: 'wi-1',
                state: 'ready',
                project_id: null,
                role: 'developer',
                role_config: {},
                metadata: {},
              },
              {
                id: 'task-open',
                workflow_id: 'wf-1',
                work_item_id: 'wi-2',
                state: 'ready',
                project_id: null,
                role: 'developer',
                role_config: {},
                metadata: {},
              },
            ],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-open',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              role_config: {},
              metadata: {},
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT') && sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        const runtimeDefault = runtimeDefaultQueryResult(sql, _params);
        if (runtimeDefault) {
          return runtimeDefault;
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const parallelismService = {
      shouldQueueForCapacity: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => defaultResolvedRoleConfig),
      parallelismService: parallelismService as never,
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    });

    expect(task?.id).toBe('task-open');
    expect(parallelismService.shouldQueueForCapacity).toHaveBeenCalledTimes(2);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'claimed'"),
      expect.arrayContaining(['tenant-1', 'task-open']),
    );
  });

  it('only promotes expired retry-backoff tasks into ready when parallelism capacity allows it', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: 'task-retry-blocked',
                workflow_id: 'wf-1',
                work_item_id: 'wi-1',
                is_orchestrator_task: false,
                state: 'pending',
              },
              {
                id: 'task-retry-open',
                workflow_id: 'wf-1',
                work_item_id: 'wi-2',
                is_orchestrator_task: false,
                state: 'pending',
              },
            ],
          };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          expect(params).toEqual(['tenant-1', 'task-retry-open']);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-retry-open',
                workflow_id: 'wf-1',
                work_item_id: 'wi-2',
                state: 'ready',
                project_id: null,
                role: 'developer',
                role_config: {},
                metadata: {},
              },
            ],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-retry-open',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              role_config: {},
              metadata: {},
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT') && sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        const runtimeDefault = runtimeDefaultQueryResult(sql, params);
        if (runtimeDefault) {
          return runtimeDefault;
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const parallelismService = {
      shouldQueueForCapacity: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false),
    };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: eventService as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => defaultResolvedRoleConfig),
      parallelismService: parallelismService as never,
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
      workflow_id: 'wf-1',
    });

    expect(task?.id).toBe('task-retry-open');
    expect(parallelismService.shouldQueueForCapacity).toHaveBeenNthCalledWith(
      1,
      'tenant-1',
      expect.objectContaining({
        taskId: 'task-retry-blocked',
        workflowId: 'wf-1',
        workItemId: 'wi-1',
        currentState: 'pending',
      }),
      client,
    );
    expect(parallelismService.shouldQueueForCapacity).toHaveBeenNthCalledWith(
      2,
      'tenant-1',
      expect.objectContaining({
        taskId: 'task-retry-open',
        workflowId: 'wf-1',
        workItemId: 'wi-2',
        currentState: 'pending',
      }),
      client,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'task-retry-open',
        data: expect.objectContaining({
          from_state: 'pending',
          to_state: 'ready',
          reason: 'retry_backoff_elapsed',
        }),
      }),
      client,
    );
  });

  it('returns claim-time secret references without echoing secrets in role_config', async () => {
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-claim',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {
                llm_api_key: 'persisted-plaintext-key',
                tools: ['shell'],
              },
              metadata: {},
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-claim',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              role_config: {
                llm_api_key: 'persisted-plaintext-key',
                tools: ['shell'],
              },
              metadata: {},
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT') && sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return { rowCount: 0, rows: [] };
        }
        const runtimeDefault = runtimeDefaultQueryResult(sql, _params);
        if (runtimeDefault) {
          return runtimeDefault;
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => ({
        provider: {
          name: 'OpenAI',
          providerId: 'provider-1',
          providerType: 'openai',
          authMode: 'api_key',
          apiKeySecretRef: 'secret:OPENAI_API_KEY',
          baseUrl: 'https://api.openai.test/v1',
        },
        model: {
          modelId: 'gpt-5',
          contextWindow: null,
          maxOutputTokens: 128000,
          endpointType: 'responses',
          reasoningConfig: null,
          inputCostPerMillionUsd: 1.25,
          outputCostPerMillionUsd: 10,
        },
        reasoningConfig: { reasoning_effort: 'low' },
      })),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    });

    expect(task?.credentials).toEqual({
      llm_provider: 'openai',
      llm_model: 'gpt-5',
      llm_context_window: null,
      llm_max_output_tokens: 128000,
      llm_reasoning_config: { reasoning_effort: 'low' },
      llm_input_cost_per_million_usd: 1.25,
      llm_output_cost_per_million_usd: 10,
      llm_api_key_secret_ref: 'secret:OPENAI_API_KEY',
      llm_base_url: 'https://api.openai.test/v1',
      llm_endpoint_type: 'responses',
    });
    expect((task?.role_config as Record<string, unknown>).llm_api_key).toBeUndefined();
  });

  it('resolves claim credentials from task-level llm provider and model overrides', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    const encryptedProviderSecret = storeProviderSecret('override-provider-secret');
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-direct-model',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {
                llm_provider: 'Smoke Provider',
                llm_model: 'gpt-smoke',
                tools: ['shell'],
              },
              metadata: {},
            }],
          };
        }
        if (sql.includes("FROM llm_models m") && sql.includes('JOIN llm_providers p')) {
          return {
            rowCount: 1,
            rows: [{
              provider_id: 'provider-override',
              provider_name: 'Smoke Provider',
              provider_base_url: 'https://provider.example/v1',
              provider_api_key_secret_ref: encryptedProviderSecret,
              provider_auth_mode: 'api_key',
              provider_metadata: { providerType: 'openai' },
              model_id: 'gpt-smoke',
              model_context_window: 64000,
              model_max_output_tokens: 96000,
              model_endpoint_type: 'responses',
              model_reasoning_config: null,
              model_input_cost_per_million_usd: '1.25',
              model_output_cost_per_million_usd: '10',
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-direct-model',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              role_config: {
                llm_provider: 'Smoke Provider',
                llm_model: 'gpt-smoke',
                tools: ['shell'],
              },
              metadata: {},
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT') && sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return { rowCount: 0, rows: [] };
        }
        const runtimeDefault = runtimeDefaultQueryResult(sql, _params);
        if (runtimeDefault) {
          return runtimeDefault;
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => null),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    });

    expect(task?.credentials).toEqual({
      llm_provider: 'openai',
      llm_model: 'gpt-smoke',
      llm_context_window: 64000,
      llm_max_output_tokens: 96000,
      llm_reasoning_config: null,
      llm_input_cost_per_million_usd: 1.25,
      llm_output_cost_per_million_usd: 10,
      llm_api_key_claim_handle: expect.stringMatching(/^claim:v1:/),
      llm_base_url: 'https://provider.example/v1',
      llm_endpoint_type: 'responses',
    });
    expect((task?.credentials as Record<string, unknown>).llm_api_key).toBeUndefined();
  });

  it('uses platform-resolved reasoning for direct task model overrides when the task does not set reasoning explicitly', async () => {
    const encryptedProviderSecret = storeProviderSecret('override-provider-secret');
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-direct-model-system-reasoning',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {
                llm_provider: 'Smoke Provider',
                llm_model: 'gpt-smoke',
                tools: ['shell'],
              },
              metadata: {},
            }],
          };
        }
        if (sql.includes("FROM llm_models m") && sql.includes('JOIN llm_providers p')) {
          return {
            rowCount: 1,
            rows: [{
              provider_id: 'provider-override',
              provider_name: 'Smoke Provider',
              provider_base_url: 'https://provider.example/v1',
              provider_api_key_secret_ref: encryptedProviderSecret,
              provider_auth_mode: 'api_key',
              provider_metadata: { providerType: 'openai' },
              model_id: 'gpt-smoke',
              model_context_window: 64000,
              model_max_output_tokens: 96000,
              model_endpoint_type: 'responses',
              model_reasoning_config: { reasoning_effort: 'high' },
              model_input_cost_per_million_usd: '1.25',
              model_output_cost_per_million_usd: '10',
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-direct-model-system-reasoning',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              role_config: {
                llm_provider: 'Smoke Provider',
                llm_model: 'gpt-smoke',
                tools: ['shell'],
              },
              metadata: {},
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT') && sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return { rowCount: 0, rows: [] };
        }
        const runtimeDefault = runtimeDefaultQueryResult(sql, _params);
        if (runtimeDefault) {
          return runtimeDefault;
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => ({
        ...defaultResolvedRoleConfig,
        reasoningConfig: { reasoning_effort: 'low' },
      })),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    });

    expect((task?.credentials as Record<string, unknown>).llm_reasoning_config).toEqual({
      reasoning_effort: 'low',
    });
  });

  it('fails direct task model overrides when provider type metadata is missing', async () => {
    const encryptedProviderSecret = storeProviderSecret('override-provider-secret');
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-direct-model-missing-provider-type',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {
                llm_provider: 'Smoke Provider',
                llm_model: 'gpt-smoke',
                tools: ['shell'],
              },
              metadata: {},
            }],
          };
        }
        if (sql.includes("FROM llm_models m") && sql.includes('JOIN llm_providers p')) {
          return {
            rowCount: 1,
            rows: [{
              provider_id: 'provider-override',
              provider_name: 'Smoke Provider',
              provider_base_url: 'https://provider.example/v1',
              provider_api_key_secret_ref: encryptedProviderSecret,
              provider_auth_mode: 'api_key',
              provider_metadata: {},
              model_id: 'gpt-smoke',
              model_context_window: 64000,
              model_max_output_tokens: 96000,
              model_endpoint_type: 'responses',
              model_reasoning_config: null,
              model_input_cost_per_million_usd: '1.25',
              model_output_cost_per_million_usd: '10',
            }],
          };
        }
        if (sql.includes('SELECT') && sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return { rowCount: 0, rows: [] };
        }
        const runtimeDefault = runtimeDefaultQueryResult(sql, _params);
        if (runtimeDefault) {
          return runtimeDefault;
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => null),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    await expect(
      service.claimTask(identity, {
        agent_id: 'agent-1',
        capabilities: ['coding'],
      }),
    ).rejects.toThrow(/providerType/i);
  });

  it('preserves explicit task reasoning for direct task model overrides', async () => {
    const encryptedProviderSecret = storeProviderSecret('override-provider-secret');
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-direct-model-explicit-reasoning',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {
                llm_provider: 'Smoke Provider',
                llm_model: 'gpt-smoke',
                llm_reasoning_config: { reasoning_effort: 'medium' },
                tools: ['shell'],
              },
              metadata: {},
            }],
          };
        }
        if (sql.includes("FROM llm_models m") && sql.includes('JOIN llm_providers p')) {
          return {
            rowCount: 1,
            rows: [{
              provider_id: 'provider-override',
              provider_name: 'Smoke Provider',
              provider_base_url: 'https://provider.example/v1',
              provider_api_key_secret_ref: encryptedProviderSecret,
              provider_auth_mode: 'api_key',
              provider_metadata: { providerType: 'openai' },
              model_id: 'gpt-smoke',
              model_context_window: 64000,
              model_max_output_tokens: 96000,
              model_endpoint_type: 'responses',
              model_reasoning_config: { reasoning_effort: 'high' },
              model_input_cost_per_million_usd: '1.25',
              model_output_cost_per_million_usd: '10',
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-direct-model-explicit-reasoning',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              role_config: {
                llm_provider: 'Smoke Provider',
                llm_model: 'gpt-smoke',
                llm_reasoning_config: { reasoning_effort: 'medium' },
                tools: ['shell'],
              },
              metadata: {},
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT') && sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return { rowCount: 0, rows: [] };
        }
        const runtimeDefault = runtimeDefaultQueryResult(sql, _params);
        if (runtimeDefault) {
          return runtimeDefault;
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => ({
        ...defaultResolvedRoleConfig,
        reasoningConfig: { reasoning_effort: 'low' },
      })),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    });

    expect((task?.credentials as Record<string, unknown>).llm_reasoning_config).toEqual({
      reasoning_effort: 'medium',
    });
  });

  it('fails before claiming when an explicit task model override cannot be resolved', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const resolveRoleConfig = vi.fn(async () => defaultResolvedRoleConfig);
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-bad-direct-model',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {
                llm_provider: 'Missing Provider',
                llm_model: 'gpt-missing',
                tools: ['shell'],
              },
              metadata: {},
            }],
          };
        }
        if (sql.includes("FROM llm_models m") && sql.includes('JOIN llm_providers p')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: eventService as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig,
      claimHandleSecret: 'test-claim-handle-secret',
    });

    await expect(service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    })).rejects.toThrow(/explicit task model override/i);

    expect(resolveRoleConfig).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'claimed'"),
      expect.anything(),
    );
  });

  it('fails before claiming when an explicit task model override is incomplete', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const resolveRoleConfig = vi.fn(async () => defaultResolvedRoleConfig);
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-incomplete-direct-model',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {
                llm_provider: 'Smoke Provider',
                tools: ['shell'],
              },
              metadata: {},
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: eventService as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig,
      claimHandleSecret: 'test-claim-handle-secret',
    });

    await expect(service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    })).rejects.toThrow(/explicit task model override/i);

    expect(resolveRoleConfig).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'claimed'"),
      expect.anything(),
    );
  });

  it('fails before claiming when no role assignment or default model is configured', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const resolveRoleConfig = vi.fn(async () => null);
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-missing-default-model',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {
                tools: ['shell'],
              },
              metadata: {},
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: eventService as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig,
      claimHandleSecret: 'test-claim-handle-secret',
    });

    await expect(
      service.claimTask(identity, {
        agent_id: 'agent-1',
        capabilities: ['coding'],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message:
        "No LLM model is configured for role 'developer'. Assign a model to the role or set a default model on the LLM Providers page before claiming tasks.",
    });

    expect(resolveRoleConfig).toHaveBeenCalledWith(identity.tenantId, 'developer');
    expect(eventService.emit).not.toHaveBeenCalled();
    const executedSql = client.query.mock.calls.map(([sql]) => String(sql));
    expect(executedSql.some((sql) => sql.includes("SET state = 'claimed'"))).toBe(false);
  });

  it('preserves raw git repository bindings on trusted agent claims', async () => {
    const rawBinding = {
      type: 'git_repository',
      repository_url: 'https://github.com/example/repo.git',
      credentials: {
        token: 'github_pat_example',
      },
    };
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-git-claim',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {},
              metadata: {},
              resource_bindings: [rawBinding],
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-git-claim',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              project_id: null,
              role_config: {},
              metadata: {},
              resource_bindings: [rawBinding],
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        const runtimeDefault = runtimeDefaultQueryResult(sql, _params);
        if (runtimeDefault) {
          return runtimeDefault;
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => ({
        ...task,
        resource_bindings: [{
          ...rawBinding,
          credentials: {
            token: 'redacted://task-secret',
          },
        }],
      }),
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => defaultResolvedRoleConfig),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    });

    expect(task?.resource_bindings).toEqual([rawBinding]);
  });

  it('returns task-bound oauth claim handles instead of decrypted at-rest values', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    const encryptedAccessToken = storeOAuthToken('oauth-access-token');
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-oauth',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {},
              metadata: {},
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-oauth',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              role_config: {},
              metadata: {},
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-encrypted-resolved',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              capabilities_required: ['coding'],
              priority: 'normal',
              metadata: {},
            }],
          };
        }
        if (sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM llm_providers WHERE id = $1 FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'provider-oauth',
              auth_mode: 'oauth',
              oauth_config: {
                profile_id: 'openai-codex',
                base_url: 'https://api.openai.test/v1',
                endpoint_type: 'responses',
                token_lifetime: 'permanent',
              },
              oauth_credentials: {
                access_token: encryptedAccessToken,
                refresh_token: null,
                expires_at: null,
                account_id: 'acct_123',
                email: 'mark@example.com',
                authorized_at: '2026-03-11T00:00:00.000Z',
                authorized_by_user_id: 'user-1',
                needs_reauth: false,
              },
            }],
          };
        }
        const runtimeDefault = runtimeDefaultQueryResult(sql, params);
        if (runtimeDefault) {
          return runtimeDefault;
        }
        throw new Error(`unexpected query: ${sql} :: ${JSON.stringify(params ?? [])}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => ({
        provider: {
          name: 'OpenAI',
          providerId: 'provider-oauth',
          providerType: 'openai',
          authMode: 'oauth',
          apiKeySecretRef: null,
          baseUrl: 'https://api.openai.test/v1',
        },
        model: {
          modelId: 'gpt-5',
          contextWindow: null,
          maxOutputTokens: null,
          endpointType: 'responses',
          reasoningConfig: null,
        },
        reasoningConfig: null,
      })),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    });

    expect(task?.credentials).toEqual(expect.objectContaining({
      llm_provider: 'openai',
      llm_model: 'gpt-5',
      llm_api_key_claim_handle: expect.stringMatching(/^claim:v1:/),
      llm_base_url: 'https://api.openai.test/v1',
      llm_endpoint_type: 'responses',
      llm_auth_mode: 'oauth',
      llm_extra_headers_claim_handle: expect.stringMatching(/^claim:v1:/),
    }));
    expect(task?.credentials).not.toHaveProperty('llm_api_key_secret_ref');
    expect(task?.credentials).not.toHaveProperty('llm_extra_headers_secret_ref');
    expect(task?.credentials).not.toHaveProperty('llm_api_key');
    expect(task?.credentials).not.toHaveProperty('llm_extra_headers');
  });

  it('returns task-bound handles instead of decrypted provider api keys on claim payloads', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    const encryptedApiKey = storeProviderSecret('provider-api-key');
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-encrypted-provider',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {},
              metadata: {},
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-encrypted-provider',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              role_config: {},
              metadata: {},
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-encrypted-resolved',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              capabilities_required: ['coding'],
              priority: 'normal',
              metadata: {},
            }],
          };
        }
        if (sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT api_key_secret_ref')) {
          return {
            rowCount: 1,
            rows: [{ api_key_secret_ref: encryptedApiKey }],
          };
        }
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return { rowCount: 0, rows: [] };
        }
        const runtimeDefault = runtimeDefaultQueryResult(sql, _params);
        if (runtimeDefault) {
          return runtimeDefault;
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => ({
        provider: {
          name: 'OpenAI',
          providerId: 'provider-1',
          providerType: 'openai',
          authMode: 'api_key',
          apiKeySecretRef: encryptedApiKey,
          baseUrl: 'https://api.openai.test/v1',
        },
        model: {
          modelId: 'gpt-5',
          contextWindow: null,
          maxOutputTokens: null,
          endpointType: 'responses',
          reasoningConfig: null,
        },
        reasoningConfig: null,
      })),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    });

    expect(task?.credentials).toEqual({
      llm_provider: 'openai',
      llm_model: 'gpt-5',
      llm_context_window: null,
      llm_max_output_tokens: null,
      llm_reasoning_config: null,
      llm_api_key_claim_handle: expect.stringMatching(/^claim:v1:/),
      llm_base_url: 'https://api.openai.test/v1',
      llm_endpoint_type: 'responses',
    });
    expect(task?.credentials).not.toHaveProperty('llm_api_key_secret_ref');
  });

  it('issues opaque claim handles and resolves them only for the assigned agent', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    const encryptedApiKey = storeProviderSecret('provider-api-key');
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-opaque',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {},
              metadata: {},
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-opaque',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              role_config: {},
              metadata: {},
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT api_key_secret_ref')) {
          return {
            rowCount: 1,
            rows: [{ api_key_secret_ref: encryptedApiKey }],
          };
        }
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT assigned_agent_id')) {
          expect(params).toEqual(['tenant-1', 'task-opaque']);
          return {
            rowCount: 1,
            rows: [{ assigned_agent_id: 'agent-1' }],
          };
        }
        const runtimeDefault = runtimeDefaultQueryResult(sql, params);
        if (runtimeDefault) {
          return runtimeDefault;
        }
        throw new Error(`unexpected query: ${sql} :: ${JSON.stringify(params ?? [])}`);
      }),
      release: vi.fn(),
    };

    const service = new TaskClaimService({
      pool: { connect: vi.fn(async () => client), query: client.query } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => ({
        provider: {
          name: 'OpenAI',
          providerId: 'provider-1',
          providerType: 'openai',
          authMode: 'api_key',
          apiKeySecretRef: encryptedApiKey,
          baseUrl: 'https://api.openai.test/v1',
        },
        model: {
          modelId: 'gpt-5',
          contextWindow: null,
          maxOutputTokens: null,
          endpointType: 'responses',
          reasoningConfig: null,
        },
        reasoningConfig: null,
      })),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    });

    const handle = (task?.credentials as Record<string, unknown>).llm_api_key_claim_handle as string;
    const legacyPayload = Buffer.from(JSON.stringify({
      task_id: 'task-opaque',
      kind: 'llm_api_key',
      stored_secret: encryptedApiKey,
    }), 'utf8').toString('base64url');

    expect(handle).toMatch(/^claim:v1:/);
    expect(handle).not.toContain('task-opaque');
    expect(handle).not.toContain(encryptedApiKey);
    expect(handle).not.toContain(legacyPayload);
    expect(handle.slice('claim:v1:'.length).split('.')).toHaveLength(3);

    const credentials = await service.resolveClaimCredentials(
      { ...identity, ownerId: 'agent-1' },
      'task-opaque',
      { llm_api_key_claim_handle: handle },
    );

    expect(credentials).toEqual({
      llm_api_key: 'provider-api-key',
    });
  });

  it('continues to resolve legacy task-bound claim handles for assigned agents', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    const encryptedApiKey = storeProviderSecret('provider-api-key');
    const encryptedHeaders = storeProviderSecret(JSON.stringify({ Authorization: 'Bearer secret-token' }));
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT assigned_agent_id')) {
          return {
            rowCount: 1,
            rows: [{ assigned_agent_id: 'agent-1' }],
          };
        }
        throw new Error(`unexpected query: ${sql} :: ${JSON.stringify(params ?? [])}`);
      }),
      release: vi.fn(),
    };

    const service = new TaskClaimService({
      pool: { connect: vi.fn(async () => client), query: client.query } as never,
      eventService: { emit: vi.fn() } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({})),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const credentials = await service.resolveClaimCredentials(
      { ...identity, ownerId: 'agent-1' },
      'task-1',
      {
        llm_api_key_claim_handle: 'claim:v1:' + Buffer.from(JSON.stringify({
          task_id: 'task-1',
          kind: 'llm_api_key',
          stored_secret: encryptedApiKey,
        }), 'utf8').toString('base64url') + '.' + createSignature('test-claim-handle-secret', {
          task_id: 'task-1',
          kind: 'llm_api_key',
          stored_secret: encryptedApiKey,
        }),
        llm_extra_headers_claim_handle: 'claim:v1:' + Buffer.from(JSON.stringify({
          task_id: 'task-1',
          kind: 'llm_extra_headers',
          stored_secret: encryptedHeaders,
        }), 'utf8').toString('base64url') + '.' + createSignature('test-claim-handle-secret', {
          task_id: 'task-1',
          kind: 'llm_extra_headers',
          stored_secret: encryptedHeaders,
        }),
      },
    );

    expect(credentials).toEqual({
      llm_api_key: 'provider-api-key',
      llm_extra_headers: { Authorization: 'Bearer secret-token' },
    });
  });

  it('creates claim handles from encrypted resolved provider secrets even without a provider id', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    const encryptedApiKey = storeProviderSecret('provider-api-key');
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-encrypted-resolved',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              capabilities_required: ['coding'],
              priority: 'normal',
              metadata: {},
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-encrypted-resolved',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              capabilities_required: ['coding'],
              priority: 'normal',
              metadata: {},
            }],
          };
        }
        if (sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT api_key_secret_ref')) {
          throw new Error('provider secret lookup should not run when provider id is absent');
        }
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return { rowCount: 0, rows: [] };
        }
        const runtimeDefault = runtimeDefaultQueryResult(sql, _params);
        if (runtimeDefault) {
          return runtimeDefault;
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => ({
        provider: {
          name: 'OpenAI',
          providerId: null,
          providerType: 'openai',
          authMode: 'api_key',
          apiKeySecretRef: encryptedApiKey,
          baseUrl: 'https://api.openai.test/v1',
        },
        model: {
          modelId: 'gpt-5',
          contextWindow: null,
          maxOutputTokens: null,
          endpointType: 'responses',
          reasoningConfig: null,
        },
        reasoningConfig: null,
      })),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['coding'],
    });

    expect(task?.credentials).toEqual({
      llm_provider: 'openai',
      llm_model: 'gpt-5',
      llm_context_window: null,
      llm_max_output_tokens: null,
      llm_reasoning_config: null,
      llm_api_key_claim_handle: expect.stringMatching(/^claim:v1:/),
      llm_base_url: 'https://api.openai.test/v1',
      llm_endpoint_type: 'responses',
    });
    expect(task?.credentials).not.toHaveProperty('llm_api_key_secret_ref');
  });
});

function createSignature(
  secret: string,
  payload: { task_id: string; kind: string; stored_secret: string },
): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return createHmac('sha256', secret).update(encoded).digest('base64url');
}
