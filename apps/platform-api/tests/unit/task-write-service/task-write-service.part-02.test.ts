import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  DEFAULT_RUNTIME_DEFAULTS,
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

  it('fails fast when the runtime default task timeout is missing', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('INSERT INTO tasks')) {
          throw new Error('task insert should not run without a default timeout');
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {} as never,
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    readRequiredPositiveIntegerRuntimeDefaultMock.mockRejectedValueOnce(
      new Error('Missing runtime default "tasks.default_timeout_minutes"'),
    );

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Implement hello world',
        },
      ),
    ).rejects.toThrow('Missing runtime default "tasks.default_timeout_minutes"');
  });

  it('fails fast when the runtime default max iterations is missing', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('INSERT INTO tasks')) {
          throw new Error('task insert should not run without a max iteration default');
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
      config: {} as never,
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    readRequiredPositiveIntegerRuntimeDefaultMock.mockImplementation(async (_db, _tenantId, key: string) => {
      if (key === 'agent.max_iterations') {
        throw new Error('Missing runtime default "agent.max_iterations"');
      }
      const value = DEFAULT_RUNTIME_DEFAULTS[key];
      if (value == null) {
        throw new Error(`unexpected runtime default lookup: ${key}`);
      }
      return value;
    });

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Implement hello world',
        },
      ),
    ).rejects.toThrow('Missing runtime default "agent.max_iterations"');
  });

  it('assigns runtime_only execution backend to orchestrator tasks', async () => {
    let insertedExecutionBackend: string | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedExecutionBackend = (values?.[26] as string) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              execution_backend: insertedExecutionBackend,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {} as never,
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const task = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Coordinate workflow',
        is_orchestrator_task: true,
      },
    );

    expect(insertedExecutionBackend).toBe('runtime_only');
    expect(task).toEqual(expect.objectContaining({ execution_backend: 'runtime_only' }));
  });

  it('assigns runtime_plus_task execution backend to specialist tasks', async () => {
    let insertedExecutionBackend: string | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedExecutionBackend = (values?.[26] as string) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              execution_backend: insertedExecutionBackend,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {} as never,
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const task = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Implement change',
        is_orchestrator_task: false,
      },
    );

    expect(insertedExecutionBackend).toBe('runtime_plus_task');
    expect(task).toEqual(expect.objectContaining({ execution_backend: 'runtime_plus_task' }));
  });

});
