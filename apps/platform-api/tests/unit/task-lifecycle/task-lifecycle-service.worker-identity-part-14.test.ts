import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService worker identity + payload semantics', () => {
  it('reopens an escalated source task in pending when escalation resolution would exceed playbook capacity', async () => {
    const eventService = { emit: vi.fn() };
    const parallelismService = {
      shouldQueueForCapacity: vi.fn(async () => true),
      releaseQueuedReadyTasks: vi.fn(async () => 1),
    };
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET') && !sql.includes('state = $4::task_state')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'escalation-task',
                state: 'completed',
                workflow_id: 'wf-1',
                is_orchestrator_task: false,
                assigned_agent_id: null,
                assigned_worker_id: null,
                role: 'reviewer',
                output: { resolution: 'Ship it' },
                metadata: { escalation_source_task_id: 'source-task' },
              },
            ],
          };
        }
        if (sql.includes("WHERE tenant_id = $1 AND state = 'pending' AND $2 = ANY(depends_on)")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT playbook_id FROM workflows WHERE tenant_id = $1 AND id = $2') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT * FROM tasks WHERE tenant_id = $1 AND id = $2 FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'source-task',
                state: 'escalated',
                workflow_id: 'wf-1',
                work_item_id: 'wi-1',
                stage_name: 'build',
                assigned_agent_id: null,
                assigned_worker_id: null,
                input: {},
                metadata: {},
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_subject_escalations') && sql.includes("status = 'open'")) {
          if (sql.includes('SELECT COUNT(*)::int AS count')) {
            return { rowCount: 1, rows: [{ count: 0 }] };
          }
          return {
            rowCount: 1,
            rows: [{ id: 'escalation-open', status: 'open' }],
          };
        }
        if (sql.startsWith('UPDATE workflow_subject_escalations')) {
          expect(values).toEqual([
            'tenant-1',
            'wf-1',
            'wi-1',
            'escalation-open',
            'resolved',
            'unblock_subject',
            null,
            'task',
            'escalation-task',
          ]);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes('escalation_status = NULL')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('state = $4::task_state')) {
          expect(values).toEqual([
            'tenant-1',
            'source-task',
            expect.objectContaining({
              escalation_resolution: expect.objectContaining({
                resolved_by_role: 'reviewer',
                resolved_by_task_id: 'escalation-task',
              }),
            }),
            'pending',
          ]);
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'escalation-task',
        state: 'in_progress',
        workflow_id: 'wf-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role: 'reviewer',
        role_config: {},
        output: null,
        metadata: { escalation_source_task_id: 'source-task' },
      }),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
    });

    await service.completeTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'escalation-task',
      {
        output: { resolution: 'Ship it' },
      },
    );

    expect(parallelismService.shouldQueueForCapacity).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        taskId: 'source-task',
        workflowId: 'wf-1',
        workItemId: 'wi-1',
        currentState: 'escalated',
      }),
      client,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'source-task',
        actorId: 'smart_escalation',
        data: expect.objectContaining({
          from_state: 'escalated',
          to_state: 'pending',
          reason: 'escalation_resolved',
        }),
      }),
      client,
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_subject_escalations'),
      [
        'tenant-1',
        'wf-1',
        'wi-1',
        'escalation-open',
        'resolved',
        'unblock_subject',
        null,
        'task',
        'escalation-task',
      ],
    );
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
        assessment_action: 'skip',
        assessment_feedback: 'No longer needed',
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
        assessment_action: 'override_output',
        assessment_feedback: 'Operator supplied the final output',
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
