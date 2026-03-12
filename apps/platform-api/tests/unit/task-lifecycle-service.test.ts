import { describe, expect, it, vi } from 'vitest';

import { TaskLifecycleService } from '../../src/services/task-lifecycle-service.js';

describe('TaskLifecycleService concurrent state guard (maintenance-sad cancellation race)', () => {
  it('prevents stale transitions from overwriting newer task state', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.startsWith('UPDATE tasks SET')) {
          // Simulate optimistic-concurrency miss: row state changed after initial read.
          return { rows: [], rowCount: 0 };
        }

        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const pool = {
      connect: vi.fn(async () => client),
    };

    const loadTaskOrThrow = vi
      .fn()
      // First read inside transition sees claimed state.
      .mockResolvedValueOnce({
        id: 'task-1',
        state: 'claimed',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
      })
      // Second read after update miss sees that cancellation won the race.
      .mockResolvedValueOnce({
        id: 'task-1',
        state: 'cancelled',
        workflow_id: null,
        assigned_agent_id: null,
        assigned_worker_id: null,
      });

    const eventService = { emit: vi.fn() };
    const workflowStateService = { recomputeWorkflowState: vi.fn() };

    const service = new TaskLifecycleService({
      pool: pool as never,
      eventService: eventService as never,
      workflowStateService: workflowStateService as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow,
      toTaskResponse: (task) => task,
    });

    const identity = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent' as const,
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-key',
    };

    await expect(service.startTask(identity, 'task-1', { agent_id: 'agent-1' })).rejects.toThrow(
      /INVALID_STATE_TRANSITION|Task state changed concurrently|Cannot transition from 'cancelled' to 'in_progress'/,
    );

    const updateCall = client.query.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).startsWith('UPDATE tasks SET'),
    );

    expect(updateCall).toBeDefined();
    expect(updateCall?.[0]).toContain('state = ANY(');

    const updateParams =
      ((updateCall as unknown[] | undefined)?.[1] as unknown[] | undefined) ?? [];
    expect(updateParams[updateParams.length - 1]).toEqual(['claimed']);

    expect(eventService.emit).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('TaskLifecycleService worker identity + payload semantics', () => {
  it('allows worker identity to complete assigned in-progress task', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-worker',
                state: 'completed',
                workflow_id: null,
                assigned_agent_id: null,
                assigned_worker_id: null,
                metrics: { duration_seconds: 4 },
                git_info: { commit_hash: 'abc123' },
                metadata: { verification: { passed: true } },
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
        id: 'task-worker',
        state: 'in_progress',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: 'worker-1',
        role_config: {},
      }),
      toTaskResponse: (task) => task,
    });

    const result = await service.completeTask(
      {
        id: 'worker-key',
        tenantId: 'tenant-1',
        scope: 'worker',
        ownerType: 'worker',
        ownerId: 'worker-1',
        keyPrefix: 'wk',
      },
      'task-worker',
      {
        output: { ok: true },
        metrics: { duration_seconds: 4 },
        git_info: { commit_hash: 'abc123' },
        verification: { passed: true },
      },
    );

    expect(result.state).toBe('completed');
    expect(result.metrics).toMatchObject({ duration_seconds: 4 });
  });

  it('moves completion to output_pending_review when output schema validation fails', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-review',
                state: 'output_pending_review',
                workflow_id: null,
                assigned_agent_id: null,
                assigned_worker_id: null,
                output: { missing: true },
                metadata: { verification: { passed: true } },
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
        id: 'task-review',
        state: 'in_progress',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role_config: {
          output_schema: {
            type: 'object',
            required: ['summary'],
            properties: { summary: { type: 'string' } },
          },
        },
      }),
      toTaskResponse: (task) => task,
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
      'task-review',
      {
        output: { missing: true },
        verification: { passed: true },
      },
    );

    expect(result.state).toBe('output_pending_review');
  });

  it('queues cancel signal for in-progress worker task before cancellation transition', async () => {
    const queueWorkerCancelSignal = vi.fn(async () => 'signal-1');

    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-cancel',
                state: 'cancelled',
                assigned_agent_id: null,
                assigned_worker_id: null,
                workflow_id: null,
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
        id: 'task-cancel',
        state: 'in_progress',
        assigned_worker_id: 'worker-1',
      }),
      toTaskResponse: (task) => task,
      queueWorkerCancelSignal,
    });

    const result = await service.cancelTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-cancel',
    );

    expect(result.state).toBe('cancelled');
    expect(queueWorkerCancelSignal).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'worker-1',
      'task-cancel',
      'manual_cancel',
      expect.any(Date),
    );
  });

  it('treats a repeated task cancellation as idempotent once the task is already cancelled', async () => {
    const queueWorkerCancelSignal = vi.fn(async () => 'signal-1');
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-cancel',
      state: 'cancelled',
      assigned_agent_id: null,
      assigned_worker_id: null,
      workflow_id: null,
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

    const result = await service.cancelTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-cancel',
    );

    expect(result).toEqual(existingTask);
    expect(queueWorkerCancelSignal).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('treats a repeated approval as idempotent once parallelism has already queued the approved task in pending', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-approve',
      state: 'pending',
      workflow_id: 'workflow-1',
      metadata: {
        review_action: 'approve',
      },
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
      parallelismService: { shouldQueueForCapacity: vi.fn(), releaseQueuedReadyTasks: vi.fn() } as never,
    });

    const result = await service.approveTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-approve',
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('records review metadata when requesting task changes', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-review-loop',
                state: 'ready',
                workflow_id: null,
                input: { review_feedback: 'Fix the failing assertions' },
                metadata: { review_action: 'request_changes', preferred_agent_id: 'agent-2' },
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
        id: 'task-review-loop',
        state: 'output_pending_review',
        workflow_id: null,
        input: { summary: 'old output' },
        rework_count: 0,
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
      'task-review-loop',
      {
        feedback: 'Fix the failing assertions',
        preferred_agent_id: 'agent-2',
      },
    );

    expect(result.state).toBe('ready');
    expect(result.input).toMatchObject({ review_feedback: 'Fix the failing assertions' });
    expect(result.metadata).toMatchObject({
      review_action: 'request_changes',
      preferred_agent_id: 'agent-2',
    });
    const updateCall = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE tasks SET')) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ review_feedback: 'Fix the failing assertions' }),
        expect.objectContaining({ review_action: 'request_changes', preferred_agent_id: 'agent-2' }),
      ]),
    );
  });

  it('treats a repeated request-changes action as idempotent once the task already reflects it', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-review-loop',
      state: 'ready',
      workflow_id: null,
      input: { review_feedback: 'Fix the failing assertions' },
      metadata: {
        review_action: 'request_changes',
        review_feedback: 'Fix the failing assertions',
        preferred_agent_id: 'agent-2',
      },
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
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
      'task-review-loop',
      {
        feedback: 'Fix the failing assertions',
        preferred_agent_id: 'agent-2',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('fails and escalates when request-changes exceeds the configured max rework count', async () => {
    const eventService = { emit: vi.fn() };
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
        state: 'output_pending_review',
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
                metadata: { preferred_worker_id: 'worker-3', review_action: 'reassign' },
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
      review_action: 'reassign',
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
        expect.objectContaining({ preferred_worker_id: 'worker-3', review_action: 'reassign' }),
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
        review_action: 'reassign',
        review_feedback: 'Move to a healthier worker',
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
        review_action: 'reassign',
        review_feedback: 'Move to a healthier worker',
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

  it('schedules retry with backoff when lifecycle retry policy marks the failure retryable', async () => {
    const eventService = { emit: vi.fn() };
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
        project_id: null,
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

  it('moves a manually escalated task into escalated state and records operator guidance metadata', async () => {
    const eventService = { emit: vi.fn() };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-manual-escalate',
                state: 'escalated',
                workflow_id: null,
                assigned_agent_id: null,
                assigned_worker_id: null,
                metadata: {
                  escalation_reason: 'Need operator guidance',
                  escalation_target: 'human',
                  escalation_awaiting_human: true,
                  review_action: 'escalate',
                  review_feedback: 'Need operator guidance',
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
        id: 'task-manual-escalate',
        state: 'in_progress',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role: 'developer',
        title: 'Needs help',
        metadata: {},
      }),
      toTaskResponse: (task) => task,
    });

    const result = await service.escalateTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-manual-escalate',
      {
        reason: 'Need operator guidance',
      },
    );

    expect(result.state).toBe('escalated');
    expect(result.metadata).toMatchObject({
      escalation_reason: 'Need operator guidance',
      escalation_target: 'human',
      escalation_awaiting_human: true,
      review_action: 'escalate',
      review_feedback: 'Need operator guidance',
    });
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.escalated' }),
      expect.anything(),
    );
  });

  it('treats a repeated manual escalation as idempotent once the task already reflects it', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-manual-escalate',
      state: 'escalated',
      metadata: {
        escalations: [
          {
            reason: 'Need operator guidance',
            target: null,
            escalated_at: '2026-03-12T00:00:00.000Z',
          },
        ],
        review_action: 'escalate',
        review_feedback: 'Need operator guidance',
      },
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
    });

    const result = await service.escalateTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-manual-escalate',
      {
        reason: 'Need operator guidance',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('records structured human escalation input onto the escalation task', async () => {
    const loadTaskOrThrow = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'source-task',
        metadata: { escalation_task_id: 'escalation-task' },
      })
      .mockResolvedValueOnce({
        id: 'escalation-task',
        input: { source_task_id: 'source-task' },
        metadata: {},
      })
      .mockResolvedValueOnce({
        id: 'escalation-task',
        input: {
          source_task_id: 'source-task',
          human_escalation_response: { instructions: 'Need a product decision' },
        },
        metadata: {},
      });

    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow,
      toTaskResponse: (task) => task,
    });

    const result = await service.respondToEscalation(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'source-task',
      {
        instructions: 'Need a product decision',
        context: { requested_by: 'ops' },
      },
    );

    expect(result.input).toMatchObject({
      human_escalation_response: {
        instructions: 'Need a product decision',
      },
    });
  });

  it('treats a repeated human escalation response as idempotent once it is recorded', async () => {
    const loadTaskOrThrow = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'source-task',
        metadata: { escalation_task_id: 'escalation-task' },
      })
      .mockResolvedValueOnce({
        id: 'escalation-task',
        input: {
          source_task_id: 'source-task',
          human_escalation_response: {
            instructions: 'Need a product decision',
            context: { requested_by: 'ops' },
          },
        },
        metadata: {
          human_escalation_response_at: '2026-03-12T00:00:00.000Z',
        },
      });

    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow,
      toTaskResponse: (task) => task,
    });

    const result = await service.respondToEscalation(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'source-task',
      {
        instructions: 'Need a product decision',
        context: { requested_by: 'ops' },
      },
    );

    expect(result).toMatchObject({
      id: 'escalation-task',
      input: {
        human_escalation_response: {
          instructions: 'Need a product decision',
          context: { requested_by: 'ops' },
        },
      },
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('treats a repeated escalation resolution as idempotent once the task already reflects it', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'escalated-task',
      state: 'ready',
      input: {
        escalation_resolution: {
          instructions: 'Proceed with the product decision',
          context: { source: 'ops' },
        },
      },
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

    const result = await service.resolveEscalation(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'escalated-task',
      {
        instructions: 'Proceed with the product decision',
        context: { source: 'ops' },
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('treats a repeated skip as idempotent once the skipped output is already stored', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-skip',
      state: 'completed',
      output: {
        skipped: true,
        reason: 'No longer needed',
      },
      metadata: {
        review_action: 'skip',
        review_feedback: 'No longer needed',
      },
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
    });

    const result = await service.skipTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-skip',
      { reason: 'No longer needed' },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('treats a repeated output override as idempotent once the overridden output is already stored', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const overriddenOutput = { summary: 'approved manually' };
    const existingTask = {
      id: 'task-override',
      state: 'completed',
      output: overriddenOutput,
      metadata: {
        review_action: 'override_output',
        review_feedback: 'Operator supplied the final output',
      },
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
    });

    const result = await service.overrideTaskOutput(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-override',
      {
        output: overriddenOutput,
        reason: 'Operator supplied the final output',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });
});
