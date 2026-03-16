import { describe, expect, it, vi } from 'vitest';

import { ConflictError } from '../../src/errors/domain-errors.js';
import { TaskWriteService } from '../../src/services/task-write-service.js';

describe('TaskWriteService', () => {
  it('defaults workflow task execution context from the workflow repository settings', async () => {
    let insertedEnvironment: Record<string, unknown> | null = null;
    let insertedBindings: string | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT workflow_id, stage_name FROM workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return {
            rowCount: 1,
            rows: [{
              repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              settings: {
                default_branch: 'main',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.com',
                credentials: {
                  git_token: 'secret:GITHUB_PAT',
                },
              },
              git_branch: null,
              parameters: {
                feature_branch: 'smoke/test/fix',
              },
            }],
          };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedEnvironment = (values?.[16] as Record<string, unknown>) ?? null;
          insertedBindings = (values?.[17] as string) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-repo-defaults',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              environment: insertedEnvironment,
              resource_bindings: insertedBindings,
            }],
          };
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

    await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Repo-backed developer task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-repo-defaults',
        role: 'developer',
      },
    );

    expect(insertedEnvironment).toEqual(
      expect.objectContaining({
        repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
        branch: 'smoke/test/fix',
        git_user_name: 'Smoke Bot',
        git_user_email: 'smoke@example.com',
      }),
    );
    expect(JSON.parse(insertedBindings ?? '[]')).toEqual([
      {
        type: 'git_repository',
        repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
        credentials: { token: 'secret:GITHUB_PAT' },
      },
    ]);
  });

  it('defaults workflow task capabilities from the resolved role definition', async () => {
    let insertedCapabilities: string[] | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT workflow_id, stage_name FROM workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedCapabilities = (values?.[14] as string[]) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-role-default',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              request_id: 'request-role-default',
              capabilities_required: insertedCapabilities,
            }],
          };
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
      resolveRoleCapabilities: vi.fn(async () => ['coding', 'testing', 'documentation']),
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
        request_id: 'request-role-default',
        role: 'developer',
      },
    );

    expect(insertedCapabilities).toEqual(['coding', 'testing', 'documentation']);
    expect(result.capabilities_required).toEqual(['coding', 'testing', 'documentation']);
  });

  it('rejects workflow specialist tasks that are not linked to a work item', async () => {
    const service = new TaskWriteService({
      pool: {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
            return { rowCount: 0, rows: [] };
          }
          throw new Error(`unexpected query: ${sql}`);
        }),
      } as never,
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

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Invalid workflow task',
          workflow_id: 'workflow-1',
          role: 'developer',
        },
      ),
    ).rejects.toThrow(/must be linked to a work item/i);
  });

  it('updates task input for non-terminal tasks and emits a task.input_updated event', async () => {
    const emit = vi.fn(async () => undefined);
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('UPDATE tasks') && sql.includes('SET input = $3::jsonb')) {
          expect(values).toEqual(['tenant-1', 'task-1', { scope: 'narrowed' }]);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              input: { scope: 'narrowed' },
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(async () => ({
        id: 'task-1',
        state: 'ready',
        input: { scope: 'broad' },
      })),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const result = await service.updateTaskInput('tenant-1', 'task-1', { scope: 'narrowed' });

    expect(result.input).toEqual({ scope: 'narrowed' });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        type: 'task.input_updated',
        entityType: 'task',
        entityId: 'task-1',
      }),
      undefined,
    );
  });

  it('defaults workflow task repository execution context from workflow parameters', async () => {
    let insertedEnvironment: Record<string, unknown> | null = null;
    let insertedBindings: string | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('SELECT workflow_id, stage_name FROM workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
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
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedEnvironment = (values?.[16] as Record<string, unknown>) ?? null;
          insertedBindings = (values?.[17] as string | null) ?? null;
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
      branch: 'smoke/test-branch',
      git_user_name: 'Smoke Bot',
      git_user_email: 'smoke@example.test',
    });
    expect(JSON.parse(insertedBindings ?? '[]')).toEqual([
      {
        type: 'git_repository',
        repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
        credentials: {
          token: 'secret:GITHUB_PAT',
        },
      },
    ]);
    expect(result.environment).toEqual(insertedEnvironment);
  });

  it('returns the existing task when request_id is replayed in the same workflow scope', async () => {
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('SELECT workflow_id, stage_name FROM workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
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
              requires_approval: false,
              requires_output_review: false,
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
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('clamps low specialist token budgets to the configured minimum before insert and replay matching', async () => {
    let insertedTokenBudget: number | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('SELECT workflow_id, stage_name FROM workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'design' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('workflow_id = $2') &&
          sql.includes('request_id = $3')
        ) {
          if (insertedTokenBudget === null) {
            return { rowCount: 0, rows: [] };
          }
          return {
            rowCount: 1,
            rows: [{
              id: 'task-budget-floor',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              request_id: 'request-budget-floor',
              role: 'architect',
              stage_name: 'design',
              depends_on: [],
              requires_approval: false,
              requires_output_review: false,
              context: {},
              role_config: null,
              environment: null,
              resource_bindings: [],
              activation_id: null,
              is_orchestrator_task: false,
              token_budget: insertedTokenBudget,
              cost_cap_usd: null,
              auto_retry: false,
              max_retries: 0,
              metadata: {},
            }],
          };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedTokenBudget = (values?.[22] as number) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-budget-floor',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              request_id: 'request-budget-floor',
              role: 'architect',
              stage_name: 'design',
              token_budget: insertedTokenBudget,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        TASK_SPECIALIST_MIN_TOKEN_BUDGET: 12000,
      },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const created = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Architect task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        role: 'architect',
        request_id: 'request-budget-floor',
        token_budget: 6000,
      },
    );

    const replayed = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Architect task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        role: 'architect',
        request_id: 'request-budget-floor',
        token_budget: 6000,
      },
    );

    expect(insertedTokenBudget).toBe(12000);
    expect(created.token_budget).toBe(12000);
    expect(replayed.id).toBe('task-budget-floor');
    expect(replayed.token_budget).toBe(12000);
  });

  it('does not reuse a request_id from a different workflow', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT workflow_id, stage_name FROM workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-2', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-2',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-2',
              request_id: 'request-1',
            }],
          };
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
        title: 'New task',
        workflow_id: 'workflow-2',
        work_item_id: 'work-item-2',
        request_id: 'request-1',
      },
    );

    expect(result.id).toBe('task-2');
    expect(pool.query).toHaveBeenCalledTimes(5);
  });

  it('loads the existing task when insert races on request_id', async () => {
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('SELECT workflow_id, stage_name FROM workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('workflow_id = $2') &&
          sql.includes('request_id = $3') &&
          values?.[1] === 'workflow-1' &&
          values?.[2] === 'request-1'
        ) {
          return pool.query.mock.calls.length === 1
            ? { rowCount: 0, rows: [] }
            : {
                rowCount: 1,
                rows: [{
                  id: 'task-raced',
                  tenant_id: 'tenant-1',
                  workflow_id: 'workflow-1',
                  work_item_id: 'work-item-1',
                  request_id: 'request-1',
                  role: null,
                  stage_name: 'implementation',
                  depends_on: [],
                  requires_approval: false,
                  requires_output_review: false,
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
                  metadata: {},
                }],
              };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn(async () => undefined) };
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
        title: 'Raced task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-1',
      },
    );

    expect(result.id).toBe('task-raced');
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('rejects a request_id replay when the existing task does not match the requested create shape', async () => {
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('SELECT workflow_id, stage_name FROM workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
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
              role: 'reviewer',
              stage_name: 'implementation',
              depends_on: [],
              requires_approval: false,
              requires_output_review: false,
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
              metadata: {},
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
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

    await expect(
      service.createTask(
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
          role: 'developer',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects plaintext secret-bearing fields in persisted task payloads', async () => {
    const service = new TaskWriteService({
      pool: { query: vi.fn() } as never,
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

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Secret task',
          input: {
            credentials: {
              git_token: 'ghp_plaintext_secret',
            },
          },
        },
      ),
    ).rejects.toThrow(/secret-bearing fields/i);
  });

  it('queues approval-required tasks when playbook parallelism capacity is full', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT workflow_id, stage_name FROM workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-approval-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              state: 'pending',
              requires_approval: true,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const parallelismService = {
      shouldQueueForCapacity: vi.fn(async () => true),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
    });

    const result = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Approval gated task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        requires_approval: true,
      },
    );

    expect(parallelismService.shouldQueueForCapacity).toHaveBeenCalledWith('tenant-1', {
      workflowId: 'workflow-1',
      workItemId: 'work-item-1',
      isOrchestratorTask: false,
      currentState: null,
    });
    expect(result.state).toBe('pending');
  });

  it('keeps approval-required tasks in awaiting_approval when capacity is available', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT workflow_id, stage_name FROM workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-approval-2',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              state: 'awaiting_approval',
              requires_approval: true,
            }],
          };
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
        title: 'Approval gated task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        requires_approval: true,
      },
    );

    expect(result.state).toBe('awaiting_approval');
  });
});
