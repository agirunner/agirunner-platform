import { describe, expect, it, vi } from 'vitest';

import { TaskWriteService } from '../../src/services/task-write-service.js';

describe('TaskWriteService', () => {
  it('returns the existing task when request_id is replayed in the same workflow scope', async () => {
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
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
              request_id: 'request-1',
              metadata: { description: 'existing' },
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
        request_id: 'request-1',
      },
    );

    expect(result.id).toBe('task-1');
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a request_id from a different workflow', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
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
        request_id: 'request-1',
      },
    );

    expect(result.id).toBe('task-2');
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('loads the existing task when insert races on request_id', async () => {
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
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
                  request_id: 'request-1',
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
        request_id: 'request-1',
      },
    );

    expect(result.id).toBe('task-raced');
    expect(eventService.emit).not.toHaveBeenCalled();
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
        requires_approval: true,
      },
    );

    expect(parallelismService.shouldQueueForCapacity).toHaveBeenCalledWith('tenant-1', {
      workflowId: 'workflow-1',
      workItemId: null,
      isOrchestratorTask: false,
      currentState: null,
    });
    expect(result.state).toBe('pending');
  });

  it('keeps approval-required tasks in awaiting_approval when capacity is available', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
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
        requires_approval: true,
      },
    );

    expect(result.state).toBe('awaiting_approval');
  });
});
