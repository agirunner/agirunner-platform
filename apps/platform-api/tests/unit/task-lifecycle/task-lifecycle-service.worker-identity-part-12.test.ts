import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService worker identity + payload semantics', () => {
  it('opens a work-item escalation when an agent escalates a workflow task to a human', async () => {
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
                id: 'task-agent-escalate-human',
                state: 'escalated',
                workflow_id: 'wf-human',
                work_item_id: 'wi-human',
                stage_name: 'review',
                assigned_agent_id: null,
                assigned_worker_id: null,
                role: 'developer',
                title: 'Prepare recommendation',
                metadata: {
                  escalation_reason: 'Need operator guidance',
                  escalation_target: 'human',
                  escalation_awaiting_human: true,
                  escalation_depth: 1,
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
        id: 'task-agent-escalate-human',
        state: 'in_progress',
        workflow_id: 'wf-human',
        work_item_id: 'wi-human',
        stage_name: 'review',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role: 'developer',
        title: 'Prepare recommendation',
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      getRoleByName: vi.fn(async () => ({
        escalation_target: 'human',
        max_escalation_depth: 2,
      })),
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
      'task-agent-escalate-human',
      {
        reason: 'Need operator guidance',
        context_summary: 'Waiting on a policy decision',
      },
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_subject_escalations'),
      expect.arrayContaining([
        'tenant-1',
        'wf-human',
        'wi-human',
        expect.objectContaining({
          kind: 'task',
          task_id: 'task-agent-escalate-human',
          work_item_id: 'wi-human',
        }),
        'Need operator guidance',
        'blocking',
        'task-agent-escalate-human',
      ]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'wf-human', 'wi-human'],
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
            context: { summary: 'Blocked on a product decision.' },
            recommendation: 'Approve the rollout.',
            blocking_task_id: '11111111-1111-1111-1111-111111111111',
            urgency: 'critical',
            escalated_at: '2026-03-12T00:00:00.000Z',
          },
        ],
        escalation_context_packet: { summary: 'Blocked on a product decision.' },
        escalation_recommendation: 'Approve the rollout.',
        escalation_blocking_task_id: '11111111-1111-1111-1111-111111111111',
        escalation_urgency: 'critical',
        assessment_action: 'escalate',
        assessment_feedback: 'Need operator guidance',
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
        context: { summary: 'Blocked on a product decision.' },
        recommendation: 'Approve the rollout.',
        blocking_task_id: '11111111-1111-1111-1111-111111111111',
        urgency: 'critical',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });


  it('treats a stale manual escalation after cancellation as idempotent', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-manual-escalate-cancelled',
      state: 'cancelled',
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

    const result = await service.escalateTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-manual-escalate-cancelled',
      {
        reason: 'Need operator guidance',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });


  it('treats a repeated agent escalation to another role as idempotent once the task already reflects it', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-agent-escalate-existing',
      state: 'escalated',
      role: 'developer',
      metadata: {
        escalation_reason: 'Need reviewer help',
        escalation_context: 'Waiting on a reviewer decision',
        escalation_work_so_far: 'Collected failing traces and current implementation notes.',
        escalation_target: 'reviewer',
        escalation_task_id: 'task-escalation-reviewer-1',
        escalation_depth: 1,
      },
      error: null,
    };
    const eventService = { emit: vi.fn() };
    const pool = { connect: vi.fn(async () => client) };
    const service = new TaskLifecycleService({
      pool: pool as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
      getRoleByName: vi.fn(async () => ({
        escalation_target: 'reviewer',
        max_escalation_depth: 3,
      })),
    });

    const result = await service.agentEscalate(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-agent-escalate-existing',
      {
        reason: 'Need reviewer help',
        context_summary: 'Waiting on a reviewer decision',
        work_so_far: 'Collected failing traces and current implementation notes.',
      },
    );

    expect(result).toEqual(existingTask);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalled();
  });


  it('treats a repeated depth-exceeded agent escalation as idempotent once the task already failed', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-agent-escalate-depth',
      state: 'failed',
      role: 'developer',
      metadata: {
        escalation_depth: 2,
        escalation_max_depth: 2,
      },
      error: {
        category: 'escalation_depth_exceeded',
        message: 'Escalation depth 2 exceeds maximum 2',
        recoverable: false,
      },
    };
    const eventService = { emit: vi.fn() };
    const pool = { connect: vi.fn(async () => client) };
    const service = new TaskLifecycleService({
      pool: pool as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
      getRoleByName: vi.fn(async () => ({
        escalation_target: 'reviewer',
        max_escalation_depth: 2,
      })),
    });

    const result = await service.agentEscalate(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-agent-escalate-depth',
      {
        reason: 'Need reviewer help',
        context_summary: 'Blocked on escalation policy.',
      },
    );

    expect(result).toEqual(existingTask);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalled();
  });


  it('treats a stale agent escalation after cancellation as idempotent', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-agent-escalate-cancelled',
      state: 'cancelled',
      role: 'developer',
      metadata: {},
      error: null,
    };
    const getRoleByName = vi.fn(async () => ({
      escalation_target: 'reviewer',
      max_escalation_depth: 3,
    }));
    const pool = { connect: vi.fn(async () => client) };
    const eventService = { emit: vi.fn() };
    const service = new TaskLifecycleService({
      pool: pool as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
      getRoleByName,
    });

    const result = await service.agentEscalate(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-agent-escalate-cancelled',
      {
        reason: 'Need reviewer help',
        context_summary: 'This should no-op after cancellation.',
      },
    );

    expect(result).toEqual(existingTask);
    expect(getRoleByName).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalled();
  });
});
