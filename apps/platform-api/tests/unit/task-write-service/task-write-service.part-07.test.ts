import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  ValidationError,
  TaskWriteService,
  readRequiredPositiveIntegerRuntimeDefaultMock,
  logSafetynetTriggeredMock,
  resetTaskWriteServiceMocks,
  isLinkedWorkItemLookup,
  isPlaybookDefinitionLookup,
} from './task-write-service-test-support.js';

describe('TaskWriteService', () => {
  beforeEach(() => {
    resetTaskWriteServiceMocks();
  });

  it('does not inherit repository execution context from workflow parameters', async () => {
    let insertedEnvironment: Record<string, unknown> | null = null;
    let insertedBindings: string | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
          return {
            rowCount: 1,
            rows: [{
              repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              settings: { default_branch: 'main' },
              git_branch: null,
              parameters: {
                feature_branch: 'smoke/test-branch',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.test',
                git_token_secret_ref: 'secret:GITHUB_PAT',
              },
            }],
          };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('work_item_id = $3') &&
          sql.includes('role = $4') &&
          sql.includes('state = ANY($5::task_state[])')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedEnvironment = (values?.[13] as Record<string, unknown>) ?? null;
          insertedBindings = (values?.[14] as string | null) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-workflow-defaults',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              environment: insertedEnvironment,
              resource_bindings: insertedBindings,
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const result = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Repo-backed developer task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-workflow-defaults',
        role: 'developer',
      },
    );

    expect(insertedEnvironment).toEqual({
      repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
      branch: 'main',
      base_branch: 'main',
      template: 'execution-workspace',
    });
    expect(JSON.parse(insertedBindings ?? '[]')).toEqual([]);
    expect(result.environment).toEqual(insertedEnvironment);
  });

  it('strips task-level llm model and reasoning overrides from workflow-linked task role_config before insert', async () => {
    let insertedRoleConfig: unknown = null;
    const eventService = { emit: vi.fn(async () => undefined) };
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks')
          && sql.includes('workflow_id = $2')
          && sql.includes('request_id = $3')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks')
          && sql.includes('work_item_id = $3')
          && sql.includes('role = $4')
          && sql.includes('state = ANY($5::task_state[])')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedRoleConfig = values?.[12] ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              workspace_id: null,
              title: 'Implement requested change',
              role: 'developer',
              stage_name: 'implementation',
              priority: 'normal',
              state: 'ready',
              depends_on: [],
              input: {},
              context: {},
              role_config: insertedRoleConfig,
              environment: null,
              resource_bindings: [],
              activation_id: null,
              request_id: 'request-1',
              is_orchestrator_task: false,
              timeout_minutes: 30,
              token_budget: null,
              cost_cap_usd: null,
              auto_retry: false,
              max_retries: 0,
              max_iterations: 500,
              llm_max_retries: 5,
              branch_id: null,
              execution_backend: 'runtime_plus_task',
              metadata: {},
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: eventService as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const result = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Implement requested change',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-1',
        role: 'developer',
        role_config: {
          llm_provider: 'OpenAI (Subscription)',
          llm_model: 'gpt-5.4-mini',
          llm_reasoning_config: { reasoning_effort: 'minimal' },
          system_prompt: 'Implement the change cleanly.',
          tools: ['shell'],
        },
      },
    );

    expect(insertedRoleConfig).toEqual({
      system_prompt: 'Implement the change cleanly.',
      tools: ['shell'],
    });
    expect(result.role_config).toEqual({
      system_prompt: 'Implement the change cleanly.',
      tools: ['shell'],
    });
  });

  it('strips task-level llm model and reasoning overrides from standalone task role_config before insert', async () => {
    let insertedRoleConfig: unknown = null;
    const eventService = { emit: vi.fn(async () => undefined) };
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks')
          && sql.includes('workflow_id IS NULL')
          && sql.includes('request_id = $2')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedRoleConfig = values?.[12] ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-standalone-1',
              tenant_id: 'tenant-1',
              workflow_id: null,
              work_item_id: null,
              workspace_id: null,
              title: 'Standalone analysis',
              role: 'developer',
              stage_name: null,
              priority: 'normal',
              state: 'ready',
              depends_on: [],
              input: {},
              context: {},
              role_config: insertedRoleConfig,
              environment: null,
              resource_bindings: [],
              activation_id: null,
              request_id: 'request-standalone-1',
              is_orchestrator_task: false,
              timeout_minutes: 30,
              token_budget: null,
              cost_cap_usd: null,
              auto_retry: false,
              max_retries: 0,
              max_iterations: 500,
              llm_max_retries: 5,
              branch_id: null,
              execution_backend: 'runtime_plus_task',
              metadata: {},
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: eventService as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const result = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Standalone analysis',
        request_id: 'request-standalone-1',
        role: 'developer',
        role_config: {
          llm_provider: 'OpenAI (Subscription)',
          llm_model: 'gpt-5.4-mini',
          llm_reasoning_config: { reasoning_effort: 'minimal' },
          system_prompt: 'Analyze the request.',
          tools: ['shell'],
        },
      },
    );

    expect(insertedRoleConfig).toEqual({
      system_prompt: 'Analyze the request.',
      tools: ['shell'],
    });
    expect(result.role_config).toEqual({
      system_prompt: 'Analyze the request.',
      tools: ['shell'],
    });
  });

  it('returns the existing task when request_id is replayed in the same workflow scope', async () => {
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
          return { rowCount: 0, rows: [] };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('workflow_id = $2') &&
          sql.includes('request_id = $3') &&
          values?.[1] === 'workflow-1' &&
          values?.[2] === 'request-1'
        ) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              request_id: 'request-1',
              role: null,
              stage_name: 'implementation',
              depends_on: [],
              context: {},
              role_config: null,
              environment: null,
              resource_bindings: [],
              activation_id: null,
              is_orchestrator_task: false,
              token_budget: null,
              cost_cap_usd: null,
              auto_retry: false,
              max_retries: 0,
              max_iterations: 500,
              llm_max_retries: 5,
              metadata: {},
            }],
          };
        }
        throw new Error('unexpected query');
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn() } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const result = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Existing task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-1',
      },
    );

    expect(result.id).toBe('task-1');
    expect(pool.query).toHaveBeenCalledTimes(5);
  });

});
