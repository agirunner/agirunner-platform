import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService worker identity + payload semantics', () => {
  it('schedules retry with backoff when lifecycle retry policy marks the failure retryable', async () => {
    const eventService = { emit: vi.fn() };
    const logService = { insert: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-retry-policy',
                state: 'pending',
                workflow_id: null,
                retry_count: 1,
                metadata: {
                  retry_backoff_seconds: 5,
                },
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-retry-policy',
        state: 'in_progress',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        retry_count: 0,
        metadata: {
          lifecycle_policy: {
            retry_policy: {
              max_attempts: 2,
              backoff_strategy: 'fixed',
              initial_backoff_seconds: 5,
              retryable_categories: ['timeout'],
            },
          },
        },
      }),
      toTaskResponse: (task) => task,
      logService: logService as never,
    });

    const result = await service.failTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-retry-policy',
      {
        error: { category: 'timeout', message: 'too slow' },
      },
    );

    expect(result.state).toBe('pending');
    expect(result.retry_count).toBe(1);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.retry_scheduled' }),
      expect.anything(),
    );
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.retry.scheduled',
        taskId: 'task-retry-policy',
        payload: expect.objectContaining({
          event_type: 'task.retry_scheduled',
          retry_count: 1,
          backoff_seconds: 5,
        }),
      }),
    );
  });


  it('releases queued specialist tasks when auto-retry backoff moves an active task to pending', async () => {
    const eventService = { emit: vi.fn() };
    const parallelismService = {
      releaseQueuedReadyTasks: vi.fn(async () => 1),
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-retry-release',
                state: 'pending',
                workflow_id: 'wf-1',
                is_orchestrator_task: false,
                retry_count: 1,
                metadata: {
                  retry_backoff_seconds: 5,
                },
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const workflowStateService = { recomputeWorkflowState: vi.fn() };
    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: workflowStateService as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-retry-release',
        state: 'in_progress',
        workflow_id: 'wf-1',
        is_orchestrator_task: false,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        retry_count: 0,
        metadata: {
          lifecycle_policy: {
            retry_policy: {
              max_attempts: 2,
              backoff_strategy: 'fixed',
              initial_backoff_seconds: 5,
              retryable_categories: ['timeout'],
            },
          },
        },
      }),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
    });

    const result = await service.failTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-retry-release',
      {
        error: { category: 'timeout', message: 'too slow' },
      },
    );

    expect(result.state).toBe('pending');
    expect(parallelismService.releaseQueuedReadyTasks).toHaveBeenCalledWith(
      eventService,
      'tenant-1',
      'wf-1',
      client,
    );
  });


  it('releases queued specialist tasks when a task enters output_pending_assessment', async () => {
    const eventService = { emit: vi.fn() };
    const parallelismService = {
      releaseQueuedReadyTasks: vi.fn(async () => 1),
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-review-slot',
                state: 'output_pending_assessment',
                workflow_id: 'wf-1',
                is_orchestrator_task: false,
                assigned_agent_id: 'agent-1',
                assigned_worker_id: null,
                metadata: {},
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-review-slot',
        state: 'in_progress',
        workflow_id: 'wf-1',
        is_orchestrator_task: false,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
      handoffService: {
        assertRequiredTaskHandoffBeforeCompletion: vi.fn(async () => undefined),
      } as never,
    });

    const result = await service.completeTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-review-slot',
      {
        output: { summary: 'ready for review' },
        verification: { passed: false },
      },
    );

    expect(result.state).toBe('output_pending_assessment');
    expect(parallelismService.releaseQueuedReadyTasks).toHaveBeenCalledWith(
      eventService,
      'tenant-1',
      'wf-1',
      client,
    );
  });


  it('respects parallelism caps when a manual retry would reopen a failed task', async () => {
    const eventService = { emit: vi.fn() };
    const parallelismService = {
      shouldQueueForCapacity: vi.fn(async () => true),
      releaseQueuedReadyTasks: vi.fn(async () => 0),
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-manual-retry',
                state: 'pending',
                workflow_id: 'wf-1',
                work_item_id: 'wi-1',
                is_orchestrator_task: false,
                retry_count: 2,
                metadata: {},
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-manual-retry',
        state: 'failed',
        workflow_id: 'wf-1',
        work_item_id: 'wi-1',
        is_orchestrator_task: false,
        assigned_agent_id: null,
        assigned_worker_id: null,
        retry_count: 1,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
    });

    const result = await service.retryTask(
      {
        id: 'admin-key',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin',
      },
      'task-manual-retry',
    );

    expect(result.state).toBe('pending');
    expect(parallelismService.shouldQueueForCapacity).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        taskId: 'task-manual-retry',
        workflowId: 'wf-1',
        workItemId: 'wi-1',
        currentState: 'failed',
      }),
      client,
    );
    expect(parallelismService.releaseQueuedReadyTasks).not.toHaveBeenCalled();
  });


  it('lets a failed task retry reclaim a younger ready slot and reopen immediately', async () => {
    const eventService = { emit: vi.fn() };
    const parallelismService = {
      shouldQueueForCapacity: vi.fn(async () => true),
      reclaimReadySlotForTask: vi.fn(async () => true),
      releaseQueuedReadyTasks: vi.fn(async () => 0),
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-manual-retry-ready',
                state: 'ready',
                workflow_id: 'wf-1',
                work_item_id: 'wi-b',
                is_orchestrator_task: false,
                retry_count: 2,
                metadata: {},
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-manual-retry-ready',
        state: 'failed',
        workflow_id: 'wf-1',
        work_item_id: 'wi-b',
        is_orchestrator_task: false,
        assigned_agent_id: null,
        assigned_worker_id: null,
        retry_count: 1,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
    });

    const result = await service.retryTask(
      {
        id: 'admin-key',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin',
      },
      'task-manual-retry-ready',
    );

    expect(result.state).toBe('ready');
    expect(parallelismService.reclaimReadySlotForTask).toHaveBeenCalledWith(
      eventService,
      'tenant-1',
      expect.objectContaining({
        taskId: 'task-manual-retry-ready',
        workflowId: 'wf-1',
        workItemId: 'wi-b',
        currentState: 'failed',
      }),
      client,
    );
    expect(parallelismService.releaseQueuedReadyTasks).not.toHaveBeenCalled();
  });
});
