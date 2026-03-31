import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  ValidationError,
  TaskWriteService,
  DEFAULT_RUNTIME_DEFAULTS,
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

  it('rejects creating a task for a paused workflow', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              workflow_id: 'workflow-1',
              workflow_state: 'paused',
              workflow_metadata: {},
              state: 'paused',
              metadata: {},
              parent_work_item_id: null,
              branch_id: null,
              branch_status: null,
              stage_name: 'drafting',
              workflow_lifecycle: 'ongoing',
              stage_status: null,
              stage_gate_status: null,
              owner_role: null,
              next_expected_actor: null,
              next_expected_action: null,
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

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Should not start while paused',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
        },
      ),
    ).rejects.toThrow('Workflow is paused');
  });

  it('rejects creating a task for a paused workflow work item', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              workflow_id: 'workflow-1',
              workflow_state: 'active',
              workflow_metadata: {},
              work_item_metadata: {
                pause_requested_at: '2026-03-30T04:00:00.000Z',
              },
              work_item_completed_at: null,
              parent_work_item_id: null,
              branch_id: null,
              branch_status: null,
              stage_name: 'drafting',
              workflow_lifecycle: 'ongoing',
              stage_status: null,
              stage_gate_status: null,
              owner_role: null,
              next_expected_actor: null,
              next_expected_action: null,
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

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Should not start while work item is paused',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
        },
      ),
    ).rejects.toThrow('Workflow work item is paused');
  });

  it('rejects creating a task for a cancelled workflow work item', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              workflow_id: 'workflow-1',
              workflow_state: 'active',
              workflow_metadata: {},
              work_item_metadata: {
                cancel_requested_at: '2026-03-30T04:05:00.000Z',
              },
              work_item_completed_at: '2026-03-30T04:05:00.000Z',
              parent_work_item_id: null,
              branch_id: null,
              branch_status: null,
              stage_name: 'drafting',
              workflow_lifecycle: 'ongoing',
              stage_status: null,
              stage_gate_status: null,
              owner_role: null,
              next_expected_actor: null,
              next_expected_action: null,
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

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Should not start while work item is cancelled',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
        },
      ),
    ).rejects.toThrow('Cancelled workflow work items cannot accept new tasks');
  });

  it('rejects creating a task once workflow cancellation is in progress', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              workflow_id: 'workflow-1',
              workflow_state: 'active',
              workflow_metadata: {
                cancel_requested_at: '2026-03-28T22:45:01.630Z',
              },
              state: 'active',
              metadata: {
                cancel_requested_at: '2026-03-28T22:45:01.630Z',
              },
              parent_work_item_id: null,
              branch_id: null,
              branch_status: null,
              stage_name: 'drafting',
              workflow_lifecycle: 'ongoing',
              stage_status: null,
              stage_gate_status: null,
              owner_role: null,
              next_expected_actor: null,
              next_expected_action: null,
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

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Should not start while cancelling',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
        },
      ),
    ).rejects.toThrow('Workflow cancellation is already in progress');
  });

  it('uses the runtime default task timeout when input omits one', async () => {
    let insertedTimeoutMinutes: number | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedTimeoutMinutes = (values?.[18] as number) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              timeout_minutes: insertedTimeoutMinutes,
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

    readRequiredPositiveIntegerRuntimeDefaultMock.mockImplementation(async (_db, _tenantId, key: string) => {
      if (key === 'tasks.default_timeout_minutes') {
        return 45;
      }
      const value = DEFAULT_RUNTIME_DEFAULTS[key];
      if (value == null) {
        throw new Error(`unexpected runtime default lookup: ${key}`);
      }
      return value;
    });

    await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Implement hello world',
      },
    );

    expect(insertedTimeoutMinutes).toBe(45);
  });

});
