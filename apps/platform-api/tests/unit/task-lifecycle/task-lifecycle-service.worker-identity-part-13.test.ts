import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService worker identity + payload semantics', () => {
  it('records structured human escalation input onto the escalation task', async () => {
    const logService = { insert: vi.fn(async () => undefined) };
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
      logService: logService as never,
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
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.escalation.response_recorded',
        taskId: 'source-task',
        payload: expect.objectContaining({
          event_type: 'task.escalation_response_recorded',
          escalation_task_id: 'escalation-task',
        }),
      }),
    );
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


  it('clears the work-item escalation when a human resolves an escalated workflow task', async () => {
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'escalated-task',
                state: 'ready',
                workflow_id: 'wf-human',
                work_item_id: 'wi-human',
                stage_name: 'review',
                assigned_agent_id: null,
                assigned_worker_id: null,
                input: {
                  escalation_resolution: {
                    instructions: 'Proceed with the product decision',
                    context: { source: 'ops' },
                  },
                },
                metadata: {
                  escalation_awaiting_human: null,
                },
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_subject_escalations') && sql.includes("status = 'open'")) {
          return {
            rowCount: 1,
            rows: [{ id: 'escalation-open', status: 'open' }],
          };
        }
        if (sql.startsWith('UPDATE workflow_subject_escalations')) {
          expect(values).toEqual([
            'tenant-1',
            'wf-human',
            'wi-human',
            'escalation-open',
            'resolved',
            'unblock_subject',
            'Proceed with the product decision',
            'user',
            'admin',
          ]);
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('SELECT COUNT(*)::int AS count')) {
          return { rowCount: 1, rows: [{ count: 0 }] };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes('escalation_status = NULL')) {
          return { rows: [], rowCount: 1 };
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
        id: 'escalated-task',
        state: 'escalated',
        workflow_id: 'wf-human',
        work_item_id: 'wi-human',
        stage_name: 'review',
        input: {},
        metadata: {
          escalation_awaiting_human: true,
        },
      }),
      toTaskResponse: (task) => task,
    });

    await service.resolveEscalation(
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

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_subject_escalations'),
      [
        'tenant-1',
        'wf-human',
        'wi-human',
        'escalation-open',
        'resolved',
        'unblock_subject',
        'Proceed with the product decision',
        'user',
        'admin',
      ],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'wf-human', 'wi-human', true, false],
    );
  });


  it('completes an escalated task when the current rework attempt already has a persisted handoff', async () => {
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('task_rework_count = $3')) {
          return {
            rowCount: 1,
            rows: [{ id: 'handoff-r3', created_at: new Date('2026-03-29T11:51:42.408Z') }],
          };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          expect(sql).toContain('completed_at = now()');
          expect(sql).not.toContain('output = NULL');
          expect(values?.[2]).toBe('completed');
          return {
            rowCount: 1,
            rows: [
              {
                id: 'escalated-task',
                state: 'completed',
                workflow_id: 'wf-human',
                work_item_id: 'wi-human',
                stage_name: 'review',
                input: {
                  escalation_resolution: {
                    instructions: 'Use the persisted handoff and settle the task.',
                    context: { source: 'ops' },
                  },
                },
                metadata: {
                  escalation_awaiting_human: null,
                },
                is_orchestrator_task: true,
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_subject_escalations') && sql.includes("status = 'open'")) {
          return {
            rowCount: 1,
            rows: [{ id: 'escalation-open', status: 'open' }],
          };
        }
        if (sql.startsWith('UPDATE workflow_subject_escalations')) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('SELECT COUNT(*)::int AS count')) {
          return { rowCount: 1, rows: [{ count: 0 }] };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes('escalation_status = NULL')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'escalated-task',
        state: 'escalated',
        workflow_id: 'wf-human',
        work_item_id: 'wi-human',
        stage_name: 'review',
        rework_count: 3,
        input: {},
        metadata: {
          escalation_awaiting_human: true,
        },
        is_orchestrator_task: true,
      }),
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
        instructions: 'Use the persisted handoff and settle the task.',
        context: { source: 'ops' },
      },
    );

    expect(result).toMatchObject({
      id: 'escalated-task',
      state: 'completed',
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE tasks SET'),
      expect.arrayContaining(['tenant-1', 'escalated-task', 'completed']),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'escalated-task',
        data: expect.objectContaining({
          from_state: 'escalated',
          to_state: 'completed',
          reason: 'escalation_resolved',
        }),
      }),
      client,
    );
  });
});
