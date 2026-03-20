import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { NativeSearchMode } from '../../src/catalogs/model-catalog.js';
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

function createService(
  client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> },
  overrides: Partial<ConstructorParameters<typeof TaskClaimService>[0]> = {},
) {
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
    ...overrides,
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
  if (key === 'specialist_execution_default_image') {
    return { rowCount: 1, rows: [{ config_value: 'agirunner-runtime-execution:local' }] };
  }
  if (key === 'specialist_execution_default_cpu') {
    return { rowCount: 1, rows: [{ config_value: '1' }] };
  }
  if (key === 'specialist_execution_default_memory') {
    return { rowCount: 1, rows: [{ config_value: '1Gi' }] };
  }
  if (key === 'specialist_execution_default_pull_policy') {
    return { rowCount: 1, rows: [{ config_value: 'if-not-present' }] };
  }
  return { rowCount: 0, rows: [] };
}

describe('TaskClaimService', () => {
  it('limits specialist agents to non-orchestrator tasks', async () => {
    const client = createClient('specialist');
    const service = createService(client);

    await service.claimTask(identity, {
      agent_id: 'agent-1',
      routing_tags: ['coding', 'role:developer'],
    });

    const taskSelectSql = String(client.query.mock.calls[3]?.[0] ?? '');
    expect(taskSelectSql).toContain('tasks.is_orchestrator_task = false');
  });

  it('limits orchestrator agents to orchestrator tasks', async () => {
    const client = createClient('orchestrator');
    const service = createService(client);

    await service.claimTask(identity, {
      agent_id: 'agent-1',
      routing_tags: ['coding', 'orchestrator'],
    });

    const taskSelectSql = String(client.query.mock.calls[3]?.[0] ?? '');
    expect(taskSelectSql).toContain('tasks.is_orchestrator_task = true');
  });

  it('filters candidate tasks by playbook_id when provided', async () => {
    const client = createClient('specialist');
    const service = createService(client);

    await service.claimTask(identity, {
      agent_id: 'agent-1',
      routing_tags: ['coding', 'role:developer'],
      playbook_id: 'playbook-1',
    });

    const taskSelectSql = String(client.query.mock.calls[3]?.[0] ?? '');
    expect(taskSelectSql).toContain('workflows.playbook_id');
    const params = (client.query.mock.calls[3]?.[1] ?? []) as unknown[];
    expect(params).toContain('playbook-1');
  });

  it('claims workflow specialist tasks by advertised role tag instead of stored capability tags', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
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
            rowCount: 2,
            rows: [
              {
                id: 'task-architect',
                workflow_id: 'wf-1',
                work_item_id: 'wi-1',
                state: 'ready',
                role: 'architect',
                workspace_id: null,
                role_config: {},
                metadata: {},
                is_orchestrator_task: false,
                max_iterations: null,
                llm_max_retries: null,
              },
              {
                id: 'task-developer',
                workflow_id: 'wf-1',
                work_item_id: 'wi-2',
                state: 'ready',
                role: 'developer',
                workspace_id: null,
                role_config: {},
                metadata: {},
                is_orchestrator_task: false,
                max_iterations: null,
                llm_max_retries: null,
              },
            ],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: params?.[1],
              workflow_id: 'wf-1',
              work_item_id: params?.[1] === 'task-developer' ? 'wi-2' : 'wi-1',
              state: 'claimed',
              role: params?.[1] === 'task-developer' ? 'developer' : 'architect',
              workspace_id: null,
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
        if (sql.includes('workflow_name')) {
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
      routing_tags: ['coding', 'role:developer'],
    });

    expect(task?.id).toBe('task-developer');
    const taskSelectSql = String(client.query.mock.calls[3]?.[0] ?? '');
    expect(taskSelectSql).not.toContain('capabilities_required');
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
              workspace_id: null,
              role_config: {},
              metadata: {},
              is_orchestrator_task: false,
              max_iterations: null,
              llm_max_retries: null,
            }],
          };
        }
        if (sql.includes("FROM runtime_defaults")) {
          const runtimeDefault = runtimeDefaultQueryResult(sql, params);
          if (runtimeDefault) {
            return runtimeDefault;
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
              workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
    });

    expect(task?.max_iterations).toBe(100);
    expect(task?.llm_max_retries).toBe(5);
    expect(task?.loop_mode).toBe('reactive');
  });

  it('attaches the effective execution container contract to claimed specialist tasks', async () => {
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
              id: 'task-execution-contract',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              state: 'ready',
              role: 'developer',
              workspace_id: null,
              role_config: {},
              metadata: {},
              is_orchestrator_task: false,
              max_iterations: null,
              llm_max_retries: null,
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-execution-contract',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              state: 'claimed',
              role: 'developer',
              workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
    });

    expect(task?.execution_container).toEqual({
      image: 'agirunner-runtime-execution:local',
      cpu: '1',
      memory: '1Gi',
      pull_policy: 'if-not-present',
    });
  });

  it('holds specialist tasks in ready state when execution-container capacity is full', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
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
              id: 'task-cap-blocked',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              state: 'ready',
              role: 'developer',
              workspace_id: null,
              role_config: {},
              metadata: {},
              is_orchestrator_task: false,
              max_iterations: null,
              llm_max_retries: null,
            }],
          };
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
    const executionContainerLeaseService = {
      reserveForTask: vi.fn(async () => ({
        reserved: false,
        active: 20,
        limit: 20,
        leaseId: null,
      })),
    };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => defaultResolvedRoleConfig),
      executionContainerLeaseService: executionContainerLeaseService as never,
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      routing_tags: ['coding', 'role:developer'],
    });

    expect(task).toBeNull();
    expect(executionContainerLeaseService.reserveForTask).toHaveBeenCalledOnce();
    expect(
      client.query.mock.calls.some(
        (call) =>
          typeof call[0] === 'string'
          && (call[0] as string).includes("SET state = 'claimed'"),
      ),
    ).toBe(false);
  });

  it('applies role execution-container overrides on top of specialist defaults', async () => {
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
              id: 'task-role-execution-override',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              state: 'ready',
              role: 'developer',
              workspace_id: null,
              role_config: {},
              metadata: {},
              is_orchestrator_task: false,
              max_iterations: null,
              llm_max_retries: null,
            }],
          };
        }
        if (
          sql.includes('SELECT execution_container_config FROM role_definitions')
          || sql.includes('SELECT execution_container_config')
        ) {
          return {
            rowCount: 1,
            rows: [{
              execution_container_config: {
                image: 'agirunner-runtime-execution:role',
                cpu: '3',
                pull_policy: 'never',
              },
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-role-execution-override',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              state: 'claimed',
              role: 'developer',
              workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
    });

    expect(task?.execution_container).toEqual({
      image: 'agirunner-runtime-execution:role',
      cpu: '3',
      memory: '1Gi',
      pull_policy: 'never',
    });
  });

  it('attaches provider-native search mode when the role grants native_search on a supported model', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
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
              id: 'task-native-search',
              workflow_id: null,
              work_item_id: null,
              state: 'ready',
              role: 'developer',
              workspace_id: null,
              role_config: {},
              metadata: {},
              is_orchestrator_task: false,
              max_iterations: null,
              llm_max_retries: null,
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-native-search',
              workflow_id: null,
              work_item_id: null,
              state: 'claimed',
              role: 'developer',
              workspace_id: null,
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
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return {
            rowCount: 1,
            rows: [{ escalation_target: null, allowed_tools: ['file_read', 'native_search'] }],
          };
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
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => ({
        ...defaultResolvedRoleConfig,
        nativeSearch: {
          mode: 'openai_web_search' as NativeSearchMode,
          defaultEnabled: true,
        },
      })),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      routing_tags: ['coding', 'role:developer'],
    });

    expect(task?.credentials).toEqual(
      expect.objectContaining({
        llm_native_search_mode: 'openai_web_search',
      }),
    );
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
              workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
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
                workspace_id: null,
                role: 'developer',
                role_config: {},
                metadata: {},
              },
              {
                id: 'task-open',
                workflow_id: 'wf-1',
                work_item_id: 'wi-2',
                state: 'ready',
                workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
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
                workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
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
              workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
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
              workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
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
              workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
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
              workspace_id: null,
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
        routing_tags: ['coding', 'role:developer'],
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
              workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
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
              workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
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
              workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
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
              workspace_id: null,
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
        routing_tags: ['coding', 'role:developer'],
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

  it('hydrates git credentials from persisted bindings without echoing them back in claimed bindings', async () => {
    const rawBinding = {
      type: 'git_repository',
      repository_url: 'https://github.com/example/repo.git',
      credentials: {
        token: storeProviderSecret('github_pat_example'),
        ssh_private_key: storeProviderSecret('ssh-private-key'),
        known_hosts: storeProviderSecret('github.com ssh-ed25519 AAAA'),
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
              workspace_id: null,
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
              workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
    });

    expect(task?.credentials).toEqual(
      expect.objectContaining({
        git_token: 'github_pat_example',
        git_ssh_private_key: 'ssh-private-key',
        git_ssh_known_hosts: 'github.com ssh-ed25519 AAAA',
      }),
    );
    expect(task?.resource_bindings).toEqual([{
      type: 'git_repository',
      repository_url: 'https://github.com/example/repo.git',
      credentials: {},
    }]);
  });

  it('preserves external git secret references while stripping them from claimed bindings', async () => {
    const rawBinding = {
      type: 'git_repository',
      repository_url: 'https://github.com/example/repo.git',
      credentials: {
        token: 'secret:GITHUB_PAT',
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
              id: 'task-git-ref-claim',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              workspace_id: null,
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
              id: 'task-git-ref-claim',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              workspace_id: null,
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
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => defaultResolvedRoleConfig),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      routing_tags: ['coding', 'role:developer'],
    });

    expect(task?.credentials).toEqual(
      expect.objectContaining({
        git_token: 'secret:GITHUB_PAT',
      }),
    );
    expect(task?.resource_bindings).toEqual([{
      type: 'git_repository',
      repository_url: 'https://github.com/example/repo.git',
      credentials: {},
    }]);
  });

  it('hydrates legacy git token_ref aliases while stripping them from claimed bindings', async () => {
    const rawBinding = {
      type: 'git_repository',
      repository_url: 'https://github.com/example/repo.git',
      credentials: {
        token_ref: 'secret:GITHUB_PAT',
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
              id: 'task-git-token-ref-claim',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              workspace_id: null,
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
              id: 'task-git-token-ref-claim',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              workspace_id: null,
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
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => defaultResolvedRoleConfig),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      routing_tags: ['coding', 'role:developer'],
    });

    expect(task?.credentials).toEqual(
      expect.objectContaining({
        git_token: 'secret:GITHUB_PAT',
      }),
    );
    expect(task?.resource_bindings).toEqual([{
      type: 'git_repository',
      repository_url: 'https://github.com/example/repo.git',
      credentials: {},
    }]);
  });

  it('hydrates legacy git secret_ref aliases while stripping them from claimed bindings', async () => {
    const rawBinding = {
      type: 'git_repository',
      repository_url: 'https://github.com/example/repo.git',
      credentials: {
        secret_ref: 'secret:GITHUB_PAT',
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
              id: 'task-git-secret-ref-claim',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              workspace_id: null,
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
              id: 'task-git-secret-ref-claim',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              workspace_id: null,
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
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => defaultResolvedRoleConfig),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      routing_tags: ['coding', 'role:developer'],
    });

    expect(task?.credentials).toEqual(
      expect.objectContaining({
        git_token: 'secret:GITHUB_PAT',
      }),
    );
    expect(task?.resource_bindings).toEqual([{
      type: 'git_repository',
      repository_url: 'https://github.com/example/repo.git',
      credentials: {},
    }]);
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
              workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
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
              workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
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
              workspace_id: null,
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
      routing_tags: ['coding', 'role:developer'],
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

  it('logs the execution contract after a successful claim', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const logService = {
      insert: vi.fn(async () => undefined),
      insertWithExecutor: vi.fn(async () => undefined),
    };
    const resolvedConfig = {
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
        contextWindow: 200000,
        maxOutputTokens: 128000,
        endpointType: 'responses',
        reasoningConfig: null,
        inputCostPerMillionUsd: 2.5,
        outputCostPerMillionUsd: 10,
      },
      reasoningConfig: { reasoning_effort: 'low' },
    };
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
              id: 'task-exec-contract',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              state: 'ready',
              role: 'developer',
              workspace_id: null,
              role_config: {},
              metadata: {},
              resource_bindings: [{
                type: 'git_repository',
                repository_url: 'https://github.com/example/repo.git',
                credentials: {
                  token: 'secret:GITHUB_PAT',
                },
              }],
              is_orchestrator_task: false,
              max_iterations: null,
              llm_max_retries: null,
            }],
          };
        }
        if (sql.includes("FROM runtime_defaults")) {
          const runtimeDefault = runtimeDefaultQueryResult(sql, params);
          if (runtimeDefault) {
            return runtimeDefault;
          }
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-exec-contract',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              state: 'claimed',
              role: 'developer',
              workspace_id: null,
              role_config: {},
              metadata: {},
              resource_bindings: [{
                type: 'git_repository',
                repository_url: 'https://github.com/example/repo.git',
                credentials: {
                  token: 'secret:GITHUB_PAT',
                },
              }],
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
      eventService: eventService as never,
      logService: logService as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => resolvedConfig),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    await service.claimTask(identity, {
      agent_id: 'agent-1',
      routing_tags: ['coding', 'role:developer'],
    });

    const contractEntry = (logService.insertWithExecutor.mock.calls[0] as unknown[] | undefined)?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(contractEntry).toBeDefined();
    expect(contractEntry).toMatchObject({
      tenantId: 'tenant-1',
      operation: 'task.execution_contract_resolved',
      workflowId: 'wf-1',
      taskId: 'task-exec-contract',
      workItemId: 'wi-1',
      payload: expect.objectContaining({
        agent_id: 'agent-1',
        llm_provider: 'openai',
        llm_model: 'gpt-5',
        llm_context_window: 200000,
        llm_max_output_tokens: 128000,
        llm_endpoint_type: 'responses',
        llm_reasoning_config: { reasoning_effort: 'low' },
        llm_input_cost_per_million_usd: 2.5,
        llm_output_cost_per_million_usd: 10,
        loop_mode: 'reactive',
        max_iterations: 100,
        llm_max_retries: 5,
        git_repository_binding_count: 1,
        binding_contains_git_credentials: false,
        has_git_token: true,
        has_git_ssh_private_key: false,
        has_git_ssh_known_hosts: false,
      }),
    });
  });

  it('does not break the claim when execution-contract logging fails', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const logService = {
      insert: vi.fn(async () => undefined),
      insertWithExecutor: vi.fn(async () => {
        throw new Error('execution log unavailable');
      }),
    };
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
              id: 'task-exec-resilient',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              state: 'ready',
              role: 'developer',
              workspace_id: null,
              role_config: {},
              metadata: {},
              is_orchestrator_task: false,
              max_iterations: null,
              llm_max_retries: null,
            }],
          };
        }
        if (sql.includes("FROM runtime_defaults")) {
          const runtimeDefault = runtimeDefaultQueryResult(sql, params);
          if (runtimeDefault) {
            return runtimeDefault;
          }
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-exec-resilient',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              state: 'claimed',
              role: 'developer',
              workspace_id: null,
              role_config: {},
              metadata: {},
              is_orchestrator_task: false,
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
      eventService: eventService as never,
      logService: logService as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => defaultResolvedRoleConfig),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      routing_tags: ['coding', 'role:developer'],
    });

    expect(task).not.toBeNull();
    expect(task?.id).toBe('task-exec-resilient');
    expect(logService.insertWithExecutor).toHaveBeenCalledTimes(1);
  });

  it('excludes secrets from the execution-contract log payload', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const logService = {
      insert: vi.fn(async () => undefined),
      insertWithExecutor: vi.fn(async () => undefined),
    };
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
              id: 'task-no-secrets',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              state: 'ready',
              role: 'developer',
              workspace_id: null,
              role_config: {
                llm_api_key: 'plaintext-key-should-not-leak',
              },
              metadata: {},
              is_orchestrator_task: false,
              max_iterations: null,
              llm_max_retries: null,
            }],
          };
        }
        if (sql.includes("FROM runtime_defaults")) {
          const runtimeDefault = runtimeDefaultQueryResult(sql, params);
          if (runtimeDefault) {
            return runtimeDefault;
          }
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-no-secrets',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              state: 'claimed',
              role: 'developer',
              workspace_id: null,
              role_config: {
                llm_api_key: 'plaintext-key-should-not-leak',
              },
              metadata: {},
              is_orchestrator_task: false,
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
      eventService: eventService as never,
      logService: logService as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => ({
        ...defaultResolvedRoleConfig,
        provider: {
          ...defaultResolvedRoleConfig.provider,
          apiKeySecretRef: 'secret:OPENAI_API_KEY',
        },
      })),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    await service.claimTask(identity, {
      agent_id: 'agent-1',
      routing_tags: ['coding', 'role:developer'],
    });

    const contractEntry = (logService.insertWithExecutor.mock.calls[0] as unknown[] | undefined)?.[1] as
      | { payload?: Record<string, unknown> }
      | undefined;
    expect(contractEntry).toBeDefined();
    const data = contractEntry?.payload as Record<string, unknown>;
    const secretKeys = [
      'llm_api_key', 'llm_api_key_secret_ref', 'llm_api_key_claim_handle',
      'llm_extra_headers', 'llm_extra_headers_secret_ref', 'llm_extra_headers_claim_handle',
      'api_key', 'access_token', 'token', 'authorization', 'apiKeySecretRef', 'baseUrl',
    ];
    for (const key of secretKeys) {
      expect(data).not.toHaveProperty(key);
    }
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
      routing_tags: ['coding', 'role:developer'],
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
