import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService worker identity + payload semantics', () => {
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
        assessment_action: 'approve',
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


  it('enqueues a workflow activation when approving a playbook-backed task', async () => {
    const eventService = { emit: vi.fn() };
    const activationDispatchService = { dispatchActivation: vi.fn(async () => 'orchestrator-task-1') };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-approve',
              state: 'ready',
              workflow_id: 'workflow-1',
              role: 'reviewer',
              title: 'Approve deliverable',
              work_item_id: 'work-item-1',
              stage_name: 'approval',
              is_orchestrator_task: false,
              metadata: { assessment_action: 'approve' },
              updated_at: new Date('2026-03-17T10:00:00Z'),
            }],
          };
        }
        if (sql.startsWith('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-approved:task-approve:Tue Mar 17 2026 10:00:00 GMT+0000 (Coordinated Universal Time)',
              reason: 'task.approved',
              event_type: 'task.approved',
              payload: { task_id: 'task-approve' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-17T10:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      activationDispatchService: activationDispatchService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-approve',
        state: 'awaiting_approval',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'approval',
        role: 'reviewer',
        title: 'Approve deliverable',
        is_orchestrator_task: false,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      workItemContinuityService: { clearAssessmentExpectation: vi.fn() } as never,
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

    expect(result.state).toBe('ready');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_activations'),
      expect.arrayContaining([
        'tenant-1',
        'workflow-1',
        expect.stringContaining('task-approved:task-approve:'),
        'task.approved',
        'task.approved',
      ]),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_queued',
        entityType: 'workflow',
        entityId: 'workflow-1',
        data: expect.objectContaining({
          event_type: 'task.approved',
          reason: 'task.approved',
        }),
      }),
      expect.anything(),
    );
    expect(activationDispatchService.dispatchActivation).toHaveBeenCalledWith(
      'tenant-1',
      'activation-1',
      client,
    );
  });


  it('records assessment metadata when requesting task changes', async () => {
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
                input: { assessment_feedback: 'Fix the failing assertions' },
                metadata: { assessment_action: 'request_changes', preferred_agent_id: 'agent-2' },
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
        state: 'output_pending_assessment',
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
    expect(result.input).toMatchObject({ assessment_feedback: 'Fix the failing assertions' });
    expect(result.metadata).toMatchObject({
      assessment_action: 'request_changes',
      preferred_agent_id: 'agent-2',
    });
    const updateCall = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE tasks SET')) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assessment_feedback: 'Fix the failing assertions' }),
        expect.objectContaining({ assessment_action: 'request_changes', preferred_agent_id: 'agent-2' }),
      ]),
    );
  });


  it('refreshes the reopened task contract from explicit rework scope when requesting changes', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-rework-scope',
                state: 'ready',
                workflow_id: null,
                input: {
                  description: 'Deliver revision 2 release-ready fields and docs.',
                  rework_completion_scope: 'Deliver revision 2 release-ready fields and docs.',
                  assessment_feedback: 'Add the release-ready payload and README coverage.',
                },
                metadata: {
                  description: 'Deliver revision 2 release-ready fields and docs.',
                  assessment_action: 'request_changes',
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
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-rework-scope',
        state: 'output_pending_assessment',
        workflow_id: null,
        input: {
          description: 'Implement revision 1 only.',
          rework_completion_scope: 'Deliver revision 2 release-ready fields and docs.',
        },
        rework_count: 0,
        metadata: {
          description: 'Implement revision 1 only.',
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
      'task-rework-scope',
      {
        feedback: 'Add the release-ready payload and README coverage.',
      },
    );

    expect(result.input).toMatchObject({
      description: 'Deliver revision 2 release-ready fields and docs.',
      rework_completion_scope: 'Deliver revision 2 release-ready fields and docs.',
      assessment_feedback: 'Add the release-ready payload and README coverage.',
    });
    expect(result.metadata).toMatchObject({
      description: 'Deliver revision 2 release-ready fields and docs.',
      assessment_action: 'request_changes',
    });

    const updateCall = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE tasks SET')) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'Deliver revision 2 release-ready fields and docs.',
          rework_completion_scope: 'Deliver revision 2 release-ready fields and docs.',
          assessment_feedback: 'Add the release-ready payload and README coverage.',
        }),
        expect.objectContaining({
          description: 'Deliver revision 2 release-ready fields and docs.',
          assessment_action: 'request_changes',
        }),
      ]),
    );
  });


  it('refreshes the reopened task description from the latest assessment feedback when no explicit rework scope exists', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-feedback-scope',
                state: 'ready',
                workflow_id: null,
                input: {
                  description:
                    'Implement the initial API baseline.\n\nRework required:\nAdd rollback coverage and refresh compatibility notes.',
                  assessment_feedback: 'Add rollback coverage and refresh compatibility notes.',
                },
                metadata: {
                  description:
                    'Implement the initial API baseline.\n\nRework required:\nAdd rollback coverage and refresh compatibility notes.',
                  assessment_action: 'request_changes',
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
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-feedback-scope',
        state: 'output_pending_assessment',
        workflow_id: null,
        input: {
          description: 'Implement the initial API baseline.',
          assessment_feedback: 'Old feedback that should be replaced.',
        },
        rework_count: 0,
        metadata: {
          description: 'Implement the initial API baseline.',
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
      'task-feedback-scope',
      {
        feedback: 'Add rollback coverage and refresh compatibility notes.',
      },
    );

    expect(result.input).toMatchObject({
      description:
        'Implement the initial API baseline.\n\nRework required:\nAdd rollback coverage and refresh compatibility notes.',
      assessment_feedback: 'Add rollback coverage and refresh compatibility notes.',
    });
    expect(result.metadata).toMatchObject({
      description:
        'Implement the initial API baseline.\n\nRework required:\nAdd rollback coverage and refresh compatibility notes.',
      assessment_action: 'request_changes',
    });

    const updateCall = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE tasks SET')) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description:
            'Implement the initial API baseline.\n\nRework required:\nAdd rollback coverage and refresh compatibility notes.',
          assessment_feedback: 'Add rollback coverage and refresh compatibility notes.',
        }),
        expect.objectContaining({
          description:
            'Implement the initial API baseline.\n\nRework required:\nAdd rollback coverage and refresh compatibility notes.',
          assessment_action: 'request_changes',
        }),
      ]),
    );
  });
});
