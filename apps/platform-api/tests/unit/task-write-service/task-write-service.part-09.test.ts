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

  it('does not reuse a request_id from a different workflow', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-2', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
        title: 'New task',
        workflow_id: 'workflow-2',
        work_item_id: 'work-item-2',
        request_id: 'request-1',
      },
    );

    expect(result.id).toBe('task-2');
    expect(pool.query).toHaveBeenCalledTimes(6);
  });

  it('loads the existing task when insert races on request_id', async () => {
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
        if (sql.startsWith('INSERT INTO tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (isPlaybookDefinitionLookup(sql)) {
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
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
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

  it('logs when a request_id replay returns the existing task', async () => {
    logSafetynetTriggeredMock.mockReset();
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
              role: 'engineer',
              title: 'Implement feature',
              stage_name: 'implementation',
              state: 'ready',
              depends_on: [],
              input: {},
              context: {},
              role_config: null,
              environment: null,
              resource_bindings: [],
              activation_id: null,
              is_orchestrator_task: false,
              timeout_minutes: 30,
              token_budget: null,
              cost_cap_usd: null,
              auto_retry: false,
              max_retries: 0,
              max_iterations: 500,
              llm_max_retries: 5,
              branch_id: null,
              metadata: {},
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
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-1',
        title: 'Implement feature',
        role: 'engineer',
        stage_name: 'implementation',
      },
    );

    expect(result).toEqual(expect.objectContaining({ id: 'task-1', request_id: 'request-1' }));
    expect(logSafetynetTriggeredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'platform.control_plane.idempotent_mutation_replay',
      }),
      'idempotent task create replay returned stored task',
      expect.objectContaining({
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-1',
      }),
    );
  });

});
