import { describe, expect, it, vi } from 'vitest';
import { ConflictError, ValidationError } from '../../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService worker identity + payload semantics', () => {
  it('treats a repeated retry as idempotent once the task has already been reopened', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-manual-retry',
      state: 'ready',
      workflow_id: 'wf-1',
      work_item_id: 'wi-1',
      assigned_agent_id: null,
      assigned_worker_id: null,
      retry_count: 2,
      metadata: {},
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
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

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });


  it('releases queued specialist tasks when an approval-gated task is cancelled', async () => {
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
                id: 'task-awaiting-approval',
                state: 'cancelled',
                workflow_id: 'wf-1',
                is_orchestrator_task: false,
                assigned_agent_id: null,
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
        id: 'task-awaiting-approval',
        state: 'awaiting_approval',
        workflow_id: 'wf-1',
        is_orchestrator_task: false,
        assigned_agent_id: null,
        assigned_worker_id: null,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
    });

    const result = await service.cancelTask(
      {
        id: 'admin-key',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin',
      },
      'task-awaiting-approval',
    );

    expect(result.state).toBe('cancelled');
    expect(parallelismService.releaseQueuedReadyTasks).toHaveBeenCalledWith(
      eventService,
      'tenant-1',
      'wf-1',
      client,
    );
  });

  it('rejects force retry for cancelled tasks', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-cancelled',
        state: 'cancelled',
        workflow_id: 'wf-1',
        work_item_id: 'wi-1',
        assigned_agent_id: null,
        assigned_worker_id: null,
        retry_count: 1,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
    });

    await expect(
      service.retryTask(
        {
          id: 'admin-key',
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: 'tenant-1',
          keyPrefix: 'admin',
        },
        'task-cancelled',
        { force: true },
      ),
    ).rejects.toThrow(ConflictError);
    expect(client.query).not.toHaveBeenCalled();
  });


  it('creates an inline escalation task when lifecycle escalation policy is enabled', async () => {
    const eventService = { emit: vi.fn() };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-escalate',
                state: 'failed',
                workflow_id: 'pipe-1',
                title: 'Compile',
                role: 'builder',
                timeout_minutes: 20,
                retry_count: 1,
                error: { category: 'validation_error', message: 'bad input' },
                metadata: {
                  lifecycle_policy: {
                    escalation: {
                      enabled: true,
                      role: 'orchestrator',

                      title_template: 'Escalation: {{task_title}}',
                    },
                  },
                },
              },
            ],
          };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          return {
            rowCount: 1,
            rows: [{ id: 'escalation-1' }],
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
        id: 'task-escalate',
        state: 'in_progress',
        workflow_id: 'pipe-1',
        workspace_id: null,
        title: 'Compile',
        role: 'builder',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        timeout_minutes: 20,
        retry_count: 1,
        metadata: {
          lifecycle_policy: {
            escalation: {
              enabled: true,
              role: 'orchestrator',
              title_template: 'Escalation: {{task_title}}',
            },
          },
        },
      }),
      toTaskResponse: (task) => task,
    });

    await service.failTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-escalate',
      {
        error: { category: 'validation_error', message: 'bad input', recoverable: false },
      },
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tasks'),
      expect.arrayContaining(['Escalation: Compile', 'orchestrator']),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.escalated' }),
      expect.anything(),
    );
  });


  it('queues lifecycle escalation tasks in pending when playbook parallelism is full', async () => {
    const eventService = { emit: vi.fn() };
    const parallelismService = {
      shouldQueueForCapacity: vi.fn(async () => true),
      releaseQueuedReadyTasks: vi.fn(async () => 1),
    };
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-escalate-pending',
                state: 'failed',
                workflow_id: 'pipe-1',
                work_item_id: 'wi-1',
                stage_name: 'build',
                title: 'Compile',
                role: 'builder',
                timeout_minutes: 20,
                retry_count: 1,
                error: { category: 'validation_error', message: 'bad input' },
                metadata: {
                  lifecycle_policy: {
                    escalation: {
                      enabled: true,
                      role: 'orchestrator',
                      title_template: 'Escalation: {{task_title}}',
                    },
                  },
                },
              },
            ],
          };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          expect(values).toEqual(expect.arrayContaining(['wi-1', 'build', 'pending']));
          return {
            rowCount: 1,
            rows: [{ id: 'escalation-queued' }],
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
        id: 'task-escalate-pending',
        state: 'in_progress',
        workflow_id: 'pipe-1',
        work_item_id: 'wi-1',
        stage_name: 'build',
        workspace_id: null,
        title: 'Compile',
        role: 'builder',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        timeout_minutes: 20,
        retry_count: 1,
        metadata: {
          lifecycle_policy: {
            escalation: {
              enabled: true,
              role: 'orchestrator',
              title_template: 'Escalation: {{task_title}}',
            },
          },
        },
      }),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
    });

    await service.failTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-escalate-pending',
      {
        error: { category: 'validation_error', message: 'bad input', recoverable: false },
      },
    );

    expect(parallelismService.shouldQueueForCapacity).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        workflowId: 'pipe-1',
        workItemId: 'wi-1',
        currentState: null,
      }),
      client,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.created',
        entityId: 'escalation-queued',
        data: expect.objectContaining({ state: 'pending' }),
      }),
      client,
    );
  });
});
