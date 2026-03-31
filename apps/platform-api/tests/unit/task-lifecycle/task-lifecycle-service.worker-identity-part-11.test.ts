import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService worker identity + payload semantics', () => {
  it('moves a manually escalated task into escalated state and records operator guidance metadata', async () => {
    const eventService = { emit: vi.fn() };
    const logService = { insert: vi.fn(async () => undefined) };
    let updateSql = '';
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          updateSql = sql;
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
                  escalation_context_packet: {
                    summary: 'The task is blocked on a product decision.',
                    artifact_id: 'artifact-1',
                  },
                  escalation_recommendation: 'Approve the staged rollout plan.',
                  escalation_blocking_task_id: '11111111-1111-1111-1111-111111111111',
                  escalation_urgency: 'important',
                  escalation_awaiting_human: true,
                  assessment_action: 'escalate',
                  assessment_feedback: 'Need operator guidance',
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
      logService: logService as never,
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
        context: {
          summary: 'The task is blocked on a product decision.',
          artifact_id: 'artifact-1',
        },
        recommendation: 'Approve the staged rollout plan.',
        blocking_task_id: '11111111-1111-1111-1111-111111111111',
        urgency: 'important',
      },
    );

    expect(result.state).toBe('escalated');
    expect(result.metadata).toMatchObject({
      escalation_reason: 'Need operator guidance',
      escalation_target: 'human',
      escalation_context_packet: {
        summary: 'The task is blocked on a product decision.',
        artifact_id: 'artifact-1',
      },
      escalation_recommendation: 'Approve the staged rollout plan.',
      escalation_blocking_task_id: '11111111-1111-1111-1111-111111111111',
      escalation_urgency: 'important',
      escalation_awaiting_human: true,
      assessment_action: 'escalate',
      assessment_feedback: 'Need operator guidance',
    });
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.escalated',
        data: expect.objectContaining({
          context: {
            summary: 'The task is blocked on a product decision.',
            artifact_id: 'artifact-1',
          },
          recommendation: 'Approve the staged rollout plan.',
          blocking_task_id: '11111111-1111-1111-1111-111111111111',
          urgency: 'important',
        }),
      }),
      expect.anything(),
    );
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.escalation.manual',
        taskId: 'task-manual-escalate',
        payload: expect.objectContaining({
          event_type: 'task.escalated',
          escalation_target: 'human',
          escalation_reason: 'Need operator guidance',
        }),
      }),
    );
    expect(updateSql).toContain('error = NULL');
  });


  it('queues role-based escalation tasks in pending and preserves work-item scope when caps are full', async () => {
    const eventService = { emit: vi.fn() };
    const logService = { insert: vi.fn(async () => undefined) };
    const parallelismService = {
      shouldQueueForCapacity: vi.fn(async () => true),
      releaseQueuedReadyTasks: vi.fn(async () => 1),
    };
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          if (sql.includes('metadata = metadata || $3::jsonb')) {
            return { rowCount: 1, rows: [] };
          }
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-role-escalate',
                state: 'escalated',
                workflow_id: 'wf-1',
                work_item_id: 'wi-role',
                stage_name: 'build',
                workspace_id: null,
                assigned_agent_id: null,
                assigned_worker_id: null,
                role: 'developer',
                title: 'Implement fix',
                metadata: {
                  escalation_reason: 'Need reviewer help',
                  escalation_target: 'reviewer',
                },
              },
            ],
          };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          expect(values).toEqual(expect.arrayContaining(['wi-role', 'build', 'pending']));
          return {
            rowCount: 1,
            rows: [{ id: 'role-escalation-task' }],
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
        id: 'task-role-escalate',
        state: 'in_progress',
        workflow_id: 'wf-1',
        work_item_id: 'wi-role',
        stage_name: 'build',
        workspace_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role: 'developer',
        title: 'Implement fix',
        input: { instructions: 'fix it' },
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      getRoleByName: vi.fn(async () => ({
        escalation_target: 'reviewer',
        max_escalation_depth: 2,
      })),
      parallelismService: parallelismService as never,
      logService: logService as never,
    });

    await service.agentEscalate(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-role-escalate',
      {
        reason: 'Need reviewer help',
        context_summary: 'Waiting on a reviewer decision',
      },
    );

    expect(parallelismService.shouldQueueForCapacity).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        workflowId: 'wf-1',
        workItemId: 'wi-role',
        currentState: null,
      }),
      client,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.created',
        entityId: 'role-escalation-task',
        data: expect.objectContaining({ state: 'pending' }),
      }),
      client,
    );
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.escalation.agent',
        taskId: 'task-role-escalate',
        workItemId: 'wi-role',
        stageName: 'build',
        payload: expect.objectContaining({
          event_type: 'task.agent_escalated',
          escalation_target: 'reviewer',
        }),
      }),
    );
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.escalation.task_created',
        taskId: 'task-role-escalate',
        workItemId: 'wi-role',
        stageName: 'build',
        payload: expect.objectContaining({
          event_type: 'task.escalation_task_created',
          escalation_task_id: 'role-escalation-task',
          target_role: 'reviewer',
          source_task_id: 'task-role-escalate',
        }),
      }),
    );
  });


  it('opens a work-item escalation when a workflow task is escalated manually', async () => {
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
                id: 'task-manual-escalate-work-item',
                state: 'escalated',
                workflow_id: 'wf-manual',
                work_item_id: 'wi-manual',
                stage_name: 'draft',
                assigned_agent_id: null,
                assigned_worker_id: null,
                role: 'developer',
                title: 'Draft the proposal',
                metadata: {
                  escalation_reason: 'Need operator guidance',
                  escalation_target: 'human',
                  escalation_awaiting_human: true,
                },
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_subject_escalations') && sql.includes("status = 'open'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('INSERT INTO workflow_subject_escalations')) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes("escalation_status = 'open'")) {
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
        id: 'task-manual-escalate-work-item',
        state: 'in_progress',
        workflow_id: 'wf-manual',
        work_item_id: 'wi-manual',
        stage_name: 'draft',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role: 'developer',
        title: 'Draft the proposal',
        metadata: {},
      }),
      toTaskResponse: (task) => task,
    });

    await service.escalateTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-manual-escalate-work-item',
      {
        reason: 'Need operator guidance',
      },
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_subject_escalations'),
      expect.arrayContaining([
        'tenant-1',
        'wf-manual',
        'wi-manual',
        expect.objectContaining({
          kind: 'task',
          task_id: 'task-manual-escalate-work-item',
          work_item_id: 'wi-manual',
        }),
        'Need operator guidance',
        'task-manual-escalate-work-item',
      ]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'wf-manual', 'wi-manual'],
    );
  });
});
