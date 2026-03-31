import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService worker identity + payload semantics', () => {
  it('allows enhanced-mode orchestrator completion to proceed without per-turn operator updates', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.includes('JOIN workflows w')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator-1']);
          return {
            rowCount: 1,
            rows: [{
              live_visibility_mode_override: 'enhanced',
              activation_id: 'activation-7',
              is_orchestrator_task: true,
            }],
          };
        }
        if (sql.includes('FROM agentic_settings')) {
          return { rowCount: 1, rows: [{ live_visibility_mode_default: 'enhanced' }] };
        }
        if (sql.includes('FROM workflow_operator_briefs')) {
          return { rowCount: 1, rows: [{ id: 'brief-orchestrator-1' }] };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator-1',
              state: 'completed',
              workflow_id: 'workflow-1',
              role: 'orchestrator',
              assigned_agent_id: null,
              assigned_worker_id: null,
              output: { ok: true },
              metadata: { verification: { passed: true } },
            }],
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
        id: 'task-orchestrator-1',
        state: 'in_progress',
        workflow_id: 'workflow-1',
        role: 'orchestrator',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role_config: {},
      }),
      toTaskResponse: (task) => task,
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
      'task-orchestrator-1',
      {
        output: { ok: true },
        verification: { passed: true },
      },
    );

    expect(result.state).toBe('completed');
  });


  it('allows standard-mode completion to proceed without per-turn operator updates', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.includes('JOIN workflows w')) {
          return {
            rowCount: 1,
            rows: [{
              live_visibility_mode_override: 'standard',
              activation_id: 'activation-1',
              is_orchestrator_task: false,
            }],
          };
        }
        if (sql.includes('FROM agentic_settings')) {
          return { rowCount: 1, rows: [{ live_visibility_mode_default: 'enhanced' }] };
        }
        if (sql.includes('FROM workflow_operator_briefs')) {
          return { rowCount: 1, rows: [{ id: 'brief-1' }] };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-standard-1',
              state: 'completed',
              workflow_id: 'workflow-1',
              role: 'developer',
              assigned_agent_id: null,
              assigned_worker_id: null,
              output: { ok: true },
              metadata: { verification: { passed: true } },
            }],
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
        id: 'task-standard-1',
        state: 'in_progress',
        workflow_id: 'workflow-1',
        role: 'developer',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role_config: {},
      }),
      toTaskResponse: (task) => task,
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
      'task-standard-1',
      {
        output: { ok: true },
        verification: { passed: true },
      },
    );

    expect(result.state).toBe('completed');
  });


  it('rejects completion recoverably when a required milestone brief is missing', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.includes('JOIN workflows w')) {
          return {
            rowCount: 1,
            rows: [{
              live_visibility_mode_override: 'standard',
              activation_id: 'activation-1',
              is_orchestrator_task: false,
            }],
          };
        }
        if (sql.includes('FROM agentic_settings')) {
          return { rowCount: 1, rows: [{ live_visibility_mode_default: 'standard' }] };
        }
        if (sql.includes('FROM workflow_operator_briefs')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          throw new Error('should not update task state when a milestone brief is missing');
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
        id: 'task-brief-1',
        state: 'in_progress',
        workflow_id: 'workflow-1',
        role: 'developer',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role_config: {},
      }),
      toTaskResponse: (task) => task,
      handoffService: {
        assertRequiredTaskHandoffBeforeCompletion: vi.fn(async () => undefined),
      } as never,
    });

    await expect(
      service.completeTask(
        {
          id: 'agent-key',
          tenantId: 'tenant-1',
          scope: 'agent',
          ownerType: 'agent',
          ownerId: 'agent-1',
          keyPrefix: 'ak',
        },
        'task-brief-1',
        {
          output: { ok: true },
          verification: { passed: true },
        },
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        reason_code: 'required_operator_milestone_brief',
        recoverable: true,
        recovery_hint: 'record_required_operator_brief',
        recovery: expect.objectContaining({
          action: 'record_operator_brief',
          execution_context_id: 'task-brief-1',
          source_kind: 'specialist',
        }),
      },
    });
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


  it('treats a stale task failure after cancellation as idempotent', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-fail-after-cancel',
      state: 'cancelled',
      assigned_agent_id: null,
      assigned_worker_id: null,
      workflow_id: 'workflow-1',
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

    const result = await service.failTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-1',
      },
      'task-fail-after-cancel',
      {
        error: {
          category: 'runtime_failure',
          message: 'late failure after cancellation',
          recoverable: false,
        },
        agent_id: 'agent-1',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });


  it('treats cancellation as idempotent once the task is already completed', async () => {
    const queueWorkerCancelSignal = vi.fn(async () => 'signal-1');
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-complete',
      state: 'completed',
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
      'task-complete',
    );

    expect(result).toEqual(existingTask);
    expect(queueWorkerCancelSignal).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });
});
