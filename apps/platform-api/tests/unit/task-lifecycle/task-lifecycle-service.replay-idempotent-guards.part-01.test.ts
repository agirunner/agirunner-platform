import { describe, expect, it, vi } from 'vitest';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle-service.js';
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

  it('returns the existing task when startTask replays for an already in-progress task with matching agent', async () => {
    const existingTask = {
      id: 'task-start-replay',
      state: 'in_progress',
      workflow_id: null,
      assigned_agent_id: 'agent-1',
      assigned_worker_id: null,
    };
    const { service, client } = buildService({
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
    });

    const result = await service.startTask(agentIdentity, 'task-start-replay', {
      agent_id: 'agent-1',
    });

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });


  it('locks the workflow row before updating a workflow-linked task to in_progress', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
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
                id: 'task-start-lock-order',
                state: 'in_progress',
                workflow_id: 'workflow-1',
                assigned_agent_id: 'agent-1',
                assigned_worker_id: null,
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const workflowStateService = { recomputeWorkflowState: vi.fn(async () => 'active') };
    const evaluateWorkflowBudget = vi.fn(async () => undefined);
    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: workflowStateService as never,
      evaluateWorkflowBudget,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'task-start-lock-order',
          state: 'claimed',
          workflow_id: 'workflow-1',
          assigned_agent_id: 'agent-1',
          assigned_worker_id: null,
        })
        .mockResolvedValueOnce({
          id: 'task-start-lock-order',
          state: 'claimed',
          workflow_id: 'workflow-1',
          assigned_agent_id: 'agent-1',
          assigned_worker_id: null,
        }),
      toTaskResponse: (task: Record<string, unknown>) => task,
    });

    await service.startTask(agentIdentity, 'task-start-lock-order', {
      agent_id: 'agent-1',
    });

    const sqls = client.query.mock.calls.map(([sql]) => String(sql));
    const workflowLockIndex = sqls.findIndex(
      (sql) => sql.includes('FROM workflows') && sql.includes('FOR UPDATE'),
    );
    const taskUpdateIndex = sqls.findIndex((sql) => sql.startsWith('UPDATE tasks SET'));

    expect(workflowLockIndex).toBeGreaterThanOrEqual(0);
    expect(taskUpdateIndex).toBeGreaterThanOrEqual(0);
    expect(workflowLockIndex).toBeLessThan(taskUpdateIndex);
    expect(workflowStateService.recomputeWorkflowState).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      client,
      expect.any(Object),
    );
    expect(evaluateWorkflowBudget).toHaveBeenCalledWith('tenant-1', 'workflow-1', client);
  });


  it('moves a started specialist work item into the active board column', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
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
                id: 'task-start-active',
                state: 'in_progress',
                workflow_id: 'workflow-1',
                work_item_id: 'work-item-1',
                assigned_agent_id: 'agent-1',
                assigned_worker_id: null,
                is_orchestrator_task: false,
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
          id: 'task-start-active',
          state: 'claimed',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          assigned_agent_id: 'agent-1',
          assigned_worker_id: null,
          is_orchestrator_task: false,
        })
        .mockResolvedValueOnce({
          id: 'task-start-active',
          state: 'claimed',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          assigned_agent_id: 'agent-1',
          assigned_worker_id: null,
          is_orchestrator_task: false,
        }),
      toTaskResponse: (task: Record<string, unknown>) => task,
    });

    await service.startTask(agentIdentity, 'task-start-active', {
      agent_id: 'agent-1',
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


  it('keeps a settled specialist work item in the active board column until explicit routing moves it', async () => {
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
                id: 'task-complete-active',
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
                column_id: 'active',
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
          id: 'task-complete-active',
          state: 'in_progress',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          assigned_agent_id: 'agent-1',
          assigned_worker_id: null,
          role_config: {},
          is_orchestrator_task: false,
        })
        .mockResolvedValueOnce({
          id: 'task-complete-active',
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

    await service.completeTask(agentIdentity, 'task-complete-active', {
      output: { summary: 'done' },
      verification: { passed: true },
    });

    expect(eventService.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.moved',
        entityId: 'work-item-1',
      }),
      expect.anything(),
    );
  });
});
