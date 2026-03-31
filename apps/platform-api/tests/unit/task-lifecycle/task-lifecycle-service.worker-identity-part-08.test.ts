import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService worker identity + payload semantics', () => {
  it('rejects a completed task when a later assessment blocks the delivered revision', async () => {
    const updatedTask = {
      id: 'task-delivery-rejected',
      state: 'failed',
      workflow_id: null,
      assigned_worker_id: null,
      assigned_agent_id: null,
      is_orchestrator_task: false,
      metadata: {
        assessment_action: 'reject',
        assessment_feedback: 'The delivered revision is rejected.',
      },
      error: {
        category: 'assessment_rejected',
        message: 'The delivered revision is rejected.',
        recoverable: true,
      },
    };
    const client = {
      query: vi.fn(async () => ({ rows: [updatedTask], rowCount: 1 })),
      release: vi.fn(),
    };
    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn(async () => undefined) } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn(async () => ({
        id: 'task-delivery-rejected',
        state: 'completed',
        workflow_id: null,
        assigned_worker_id: null,
        assigned_agent_id: null,
        is_orchestrator_task: false,
        metadata: {},
      })),
      toTaskResponse: (task) => task,
    });

    const result = await service.rejectTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-delivery-rejected',
      {
        feedback: 'The delivered revision is rejected.',
      },
    );

    expect(result).toEqual(updatedTask);
    expect(client.query).toHaveBeenCalled();
  });


  it('fails and escalates when request-changes exceeds the configured max rework count', async () => {
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
                id: 'task-max-rework',
                state: 'failed',
                workflow_id: 'pipe-1',
                title: 'Compile',
                role: 'builder',
                timeout_minutes: 15,
                rework_count: 3,
                metadata: {
                  lifecycle_policy: {
                    rework: { max_cycles: 2 },
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
            rows: [{ id: 'escalation-2' }],
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
        id: 'task-max-rework',
        state: 'output_pending_assessment',
        workflow_id: 'pipe-1',
        title: 'Compile',
        role: 'builder',
        timeout_minutes: 15,
        rework_count: 2,
        input: {},
        metadata: {
          lifecycle_policy: {
            rework: { max_cycles: 2 },
            escalation: {
              enabled: true,
              role: 'orchestrator',
              title_template: 'Escalation: {{task_title}}',
            },
          },
        },
      }),
      toTaskResponse: (task) => task,
      logService: logService as never,
    });

    const result = await service.requestTaskChanges(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-max-rework',
      {
        feedback: 'Still broken',
      },
    );

    expect(result.state).toBe('failed');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.max_rework_exceeded' }),
      expect.anything(),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.escalation' }),
      expect.anything(),
    );
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.max_rework_exceeded',
        taskId: 'task-max-rework',
        payload: expect.objectContaining({
          event_type: 'task.max_rework_exceeded',
          max_rework_count: 2,
        }),
      }),
    );
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.escalation.policy',
        taskId: 'task-max-rework',
        payload: expect.objectContaining({
          event_type: 'task.escalation',
        }),
      }),
    );
  });


  it('uses the default max rework count of 10 when no lifecycle policy is present', async () => {
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-default-rework-limit',
                state: (values?.[2] as string) ?? 'ready',
                workflow_id: null,
                input: { assessment_feedback: 'Try one more time' },
                rework_count: 10,
                metadata: { assessment_action: 'request_changes' },
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const eventService = { emit: vi.fn() };
    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-default-rework-limit',
        state: 'output_pending_assessment',
        workflow_id: null,
        input: { summary: 'old output' },
        rework_count: 9,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
    });

    const result = await service.requestTaskChanges(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-default-rework-limit',
      {
        feedback: 'Try one more time',
      },
    );

    expect(result.state).toBe('ready');
    expect(result.rework_count).toBe(10);
    expect(eventService.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.max_rework_exceeded' }),
      expect.anything(),
    );
  });


  it('queues cancel signal before reassigning an in-progress task', async () => {
    const queueWorkerCancelSignal = vi.fn(async () => 'signal-2');
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-reassign',
                state: 'ready',
                workflow_id: null,
                metadata: { preferred_worker_id: 'worker-3', assessment_action: 'reassign' },
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
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-reassign',
        state: 'in_progress',
        workflow_id: null,
        assigned_worker_id: 'worker-2',
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      queueWorkerCancelSignal,
    });

    const result = await service.reassignTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-reassign',
      {
        preferred_worker_id: 'worker-3',
        reason: 'Move to a healthier worker',
      },
    );

    expect(result.state).toBe('ready');
    expect(result.metadata).toMatchObject({
      preferred_worker_id: 'worker-3',
      assessment_action: 'reassign',
    });
    expect(queueWorkerCancelSignal).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'worker-2',
      'task-reassign',
      'manual_cancel',
      expect.any(Date),
    );
    const updateCall = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE tasks SET')) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ preferred_worker_id: 'worker-3', assessment_action: 'reassign' }),
      ]),
    );
  });


  it('treats a repeated reassign action as idempotent once the task already reflects it', async () => {
    const queueWorkerCancelSignal = vi.fn(async () => 'signal-2');
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-reassign',
      state: 'ready',
      workflow_id: null,
      metadata: {
        preferred_worker_id: 'worker-3',
        assessment_action: 'reassign',
        assessment_feedback: 'Move to a healthier worker',
      },
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
      queueWorkerCancelSignal,
    });

    const result = await service.reassignTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-reassign',
      {
        preferred_worker_id: 'worker-3',
        reason: 'Move to a healthier worker',
      },
    );

    expect(result).toEqual(existingTask);
    expect(queueWorkerCancelSignal).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });


  it('treats a repeated reassign action as idempotent when the requested reassignment is already pending behind parallelism', async () => {
    const queueWorkerCancelSignal = vi.fn(async () => 'signal-2');
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-reassign',
      state: 'pending',
      workflow_id: 'workflow-1',
      metadata: {
        preferred_worker_id: 'worker-3',
        assessment_action: 'reassign',
        assessment_feedback: 'Move to a healthier worker',
      },
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
      queueWorkerCancelSignal,
    });

    const result = await service.reassignTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-reassign',
      {
        preferred_worker_id: 'worker-3',
        reason: 'Move to a healthier worker',
      },
    );

    expect(result).toEqual(existingTask);
    expect(queueWorkerCancelSignal).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });
});
