import { describe, expect, it, vi } from 'vitest';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];

describe('TaskLifecycleService replay-safe idempotent guards', () => {
  const agentIdentity = {
    id: 'agent-key',
    tenantId: 'tenant-1',
    scope: 'agent' as const,
    ownerType: 'agent',
    ownerId: 'agent-1',
    keyPrefix: 'ak',
  };

  function buildService(overrides: Partial<TaskLifecycleDependencies> = {}) {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    return {
      client,
      service: new TaskLifecycleService({
        pool: { connect: vi.fn(async () => client) } as never,
        eventService: { emit: vi.fn() } as never,
        workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
        defaultTaskTimeoutMinutes: 30,
        loadTaskOrThrow: vi.fn(),
        toTaskResponse: (task: Record<string, unknown>) => task,
        ...overrides,
      }),
    };
  }

  it('promotes an already-engaged work item back into the active board column on completion', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const handoffService = {
      assertRequiredTaskHandoffBeforeCompletion: vi.fn(async () => undefined),
    };
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows') && sql.includes('FOR UPDATE')) {
          return { rows: [{ id: 'workflow-1' }], rowCount: 1 };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-complete-recover-active',
                state: 'completed',
                workflow_id: 'workflow-1',
                work_item_id: 'work-item-1',
                assigned_agent_id: null,
                assigned_worker_id: null,
                is_orchestrator_task: false,
                output: { summary: 'done' },
                metadata: {},
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [
              {
                workflow_id: 'workflow-1',
                work_item_id: 'work-item-1',
                stage_name: 'implementation',
                column_id: 'planned',
                completed_at: null,
                blocked_state: null,
                escalation_status: null,
                definition: {
                  process_instructions: 'Keep work moving.',
                  roles: [],
                  board: {
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'active', label: 'In Progress' },
                      { id: 'blocked', label: 'Blocked', is_blocked: true },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [],
                },
              },
            ],
          };
        }
        if (sql.includes('COUNT(*)::int AS engaged_task_count')) {
          return { rows: [{ engaged_task_count: 1 }], rowCount: 1 };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes('SET column_id = $4')) {
          expect(values).toEqual(['tenant-1', 'workflow-1', 'work-item-1', 'active']);
          return { rows: [{ id: 'work-item-1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const workflowStateService = { recomputeWorkflowState: vi.fn(async () => 'active') };
    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: workflowStateService as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'task-complete-recover-active',
          state: 'in_progress',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          assigned_agent_id: 'agent-1',
          assigned_worker_id: null,
          role_config: {},
          is_orchestrator_task: false,
        })
        .mockResolvedValueOnce({
          id: 'task-complete-recover-active',
          state: 'in_progress',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          assigned_agent_id: 'agent-1',
          assigned_worker_id: null,
          role_config: {},
          is_orchestrator_task: false,
        }),
      toTaskResponse: (task: Record<string, unknown>) => task,
      handoffService: handoffService as never,
    });

    await service.completeTask(agentIdentity, 'task-complete-recover-active', {
      output: { summary: 'done' },
      verification: { passed: true },
    });

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.moved',
        entityId: 'work-item-1',
        data: expect.objectContaining({
          previous_column_id: 'planned',
          column_id: 'active',
        }),
      }),
      client,
    );
  });


  it('does not short-circuit startTask when the in-progress task belongs to a different agent', async () => {
    const existingTask = {
      id: 'task-start-different-agent',
      state: 'in_progress',
      workflow_id: null,
      assigned_agent_id: 'agent-other',
      assigned_worker_id: null,
    };
    const loadTaskOrThrow = vi
      .fn()
      .mockResolvedValueOnce(existingTask)
      .mockResolvedValueOnce(existingTask);
    const { service } = buildService({ loadTaskOrThrow });

    await expect(
      service.startTask(agentIdentity, 'task-start-different-agent', { agent_id: 'agent-1' }),
    ).rejects.toThrow();
  });


  it('returns the existing task when completeTask replays for an already completed task with matching output', async () => {
    const existingTask = {
      id: 'task-complete-replay',
      state: 'completed',
      workflow_id: null,
      assigned_agent_id: 'agent-1',
      assigned_worker_id: null,
      output: { summary: 'done' },
      role_config: {},
    };
    const { service, client } = buildService({
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
    });

    const result = await service.completeTask(agentIdentity, 'task-complete-replay', {
      output: { summary: 'done' },
    });

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });


  it('returns the existing task when completeTask replays for an output_pending_assessment task with matching output', async () => {
    const existingTask = {
      id: 'task-review-replay',
      state: 'output_pending_assessment',
      workflow_id: null,
      assigned_agent_id: 'agent-1',
      assigned_worker_id: null,
      output: { result: 42 },
      role_config: {},
    };
    const { service, client } = buildService({
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
    });

    const result = await service.completeTask(agentIdentity, 'task-review-replay', {
      output: { result: 42 },
    });

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });


  it('does not short-circuit completeTask when the stored output differs from the payload', async () => {
    const existingTask = {
      id: 'task-complete-diff-output',
      state: 'completed',
      workflow_id: null,
      assigned_agent_id: 'agent-1',
      assigned_worker_id: null,
      output: { summary: 'done' },
      role_config: {},
    };
    const loadTaskOrThrow = vi
      .fn()
      .mockResolvedValueOnce(existingTask)
      .mockResolvedValueOnce(existingTask);
    const { service } = buildService({ loadTaskOrThrow });

    await expect(
      service.completeTask(agentIdentity, 'task-complete-diff-output', {
        output: { summary: 'different' },
      }),
    ).rejects.toThrow();
  });


  it('returns the existing task when failTask replays for an already failed task with matching error', async () => {
    const existingTask = {
      id: 'task-fail-replay',
      state: 'failed',
      workflow_id: null,
      assigned_agent_id: 'agent-1',
      assigned_worker_id: null,
      error: { category: 'timeout', message: 'too slow' },
      metadata: {},
    };
    const { service, client } = buildService({
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
    });

    const result = await service.failTask(agentIdentity, 'task-fail-replay', {
      error: { category: 'timeout', message: 'too slow' },
    });

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });


  it('returns the existing task when failTask replays and the task has already retried to pending with matching retry_last_error', async () => {
    const existingTask = {
      id: 'task-fail-retried',
      state: 'pending',
      workflow_id: null,
      assigned_agent_id: null,
      assigned_worker_id: null,
      error: null,
      metadata: {
        retry_last_error: { category: 'timeout', message: 'too slow' },
      },
    };
    const { service, client } = buildService({
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
    });

    const result = await service.failTask(agentIdentity, 'task-fail-retried', {
      error: { category: 'timeout', message: 'too slow' },
    });

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });


  it('returns the existing task when failTask replays and the task has already retried to ready with matching retry_last_error', async () => {
    const existingTask = {
      id: 'task-fail-retried-ready',
      state: 'ready',
      workflow_id: null,
      assigned_agent_id: null,
      assigned_worker_id: null,
      error: null,
      metadata: {
        retry_last_error: { category: 'timeout', message: 'too slow' },
      },
    };
    const { service, client } = buildService({
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
    });

    const result = await service.failTask(agentIdentity, 'task-fail-retried-ready', {
      error: { category: 'timeout', message: 'too slow' },
    });

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });


  it('does not short-circuit failTask when the stored error differs from the payload', async () => {
    const existingTask = {
      id: 'task-fail-diff-error',
      state: 'failed',
      workflow_id: null,
      assigned_agent_id: 'agent-1',
      assigned_worker_id: null,
      error: { category: 'timeout', message: 'too slow' },
      metadata: {},
    };
    const loadTaskOrThrow = vi
      .fn()
      .mockResolvedValueOnce(existingTask)
      .mockResolvedValueOnce(existingTask);
    const { service } = buildService({ loadTaskOrThrow });

    await expect(
      service.failTask(agentIdentity, 'task-fail-diff-error', {
        error: { category: 'validation_error', message: 'bad input' },
      }),
    ).rejects.toThrow();
  });
});
