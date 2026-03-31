import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService worker identity + payload semantics', () => {
  it('enqueues a workflow activation when an assessment requests changes on a playbook-backed task', async () => {
    const eventService = { emit: vi.fn() };
    const activationDispatchService = { dispatchActivation: vi.fn(async () => 'orchestrator-task-2') };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-review-loop',
              state: 'ready',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              stage_name: 'review',
              role: 'reviewer',
              title: 'Review deliverable',
              is_orchestrator_task: false,
              input: { assessment_feedback: 'Fix the failing assertions' },
              metadata: { assessment_action: 'request_changes', preferred_agent_id: 'agent-2' },
              rework_count: 1,
              updated_at: new Date('2026-03-17T10:15:00Z'),
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
              id: 'activation-2',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-assessment-requested:task-review-loop:Tue Mar 17 2026 10:15:00 GMT+0000 (Coordinated Universal Time)',
              reason: 'task.assessment_requested_changes',
              event_type: 'task.assessment_requested_changes',
              payload: { task_id: 'task-review-loop' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-17T10:15:00Z'),
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
        id: 'task-review-loop',
        state: 'output_pending_assessment',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'review',
        role: 'reviewer',
        title: 'Review deliverable',
        is_orchestrator_task: false,
        input: { summary: 'old output' },
        rework_count: 0,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      workItemContinuityService: { recordAssessmentRequestedChanges: vi.fn() } as never,
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
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_activations'),
      expect.arrayContaining([
        'tenant-1',
        'workflow-1',
        expect.stringContaining('task-assessment-requested:task-review-loop:'),
        'task.assessment_requested_changes',
        'task.assessment_requested_changes',
      ]),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_queued',
        entityType: 'workflow',
        entityId: 'workflow-1',
        data: expect.objectContaining({
          event_type: 'task.assessment_requested_changes',
          reason: 'task.assessment_requested_changes',
        }),
      }),
      expect.anything(),
    );
    expect(activationDispatchService.dispatchActivation).toHaveBeenCalledWith(
      'tenant-1',
      'activation-2',
      client,
    );
  });


  it('clears stale child review work item routing when request-changes reopens implementation rework', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-impl',
              state: 'ready',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              stage_name: 'implementation',
              role: 'developer',
              title: 'Implement change',
              is_orchestrator_task: false,
              input: { assessment_feedback: 'Tighten the invalid-input assertions' },
              metadata: { assessment_action: 'request_changes' },
              rework_count: 1,
              updated_at: new Date('2026-03-21T02:10:00Z'),
            }],
          };
        }
        if (
          sql.includes('FROM workflow_work_items wi')
          && sql.includes('JOIN workflows w')
          && sql.includes('JOIN playbooks p')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation-item']);
          return {
            rowCount: 1,
            rows: [{
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              stage_name: 'implementation',
              column_id: 'done',
              completed_at: new Date('2026-03-21T02:05:00Z'),
              definition: {
                roles: ['developer', 'reviewer'],
                lifecycle: 'planned',
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'implementation', goal: 'Implement the change' },
                  { name: 'review', goal: 'Review the change' },
                ],
              },
            }],
          };
        }
        if (
          sql.includes('UPDATE workflow_work_items')
          && sql.includes('SET column_id = $4')
          && sql.includes('completed_at = NULL')
          && sql.includes('id = $3')
          && sql.includes('(completed_at IS NOT NULL OR column_id = $5)')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation-item', 'planned', 'done']);
          return {
            rowCount: 1,
            rows: [{
              id: 'implementation-item',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes("parent_work_item_id = $3")) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-2',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-assessment-requested:task-impl:Fri Mar 21 2026 02:10:00 GMT+0000 (Coordinated Universal Time)',
              reason: 'task.assessment_requested_changes',
              event_type: 'task.assessment_requested_changes',
              payload: { task_id: 'task-impl' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-21T02:10:00Z'),
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
    const recordAssessmentRequestedChanges = vi.fn(async () => undefined);

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-impl',
        state: 'output_pending_assessment',
        workflow_id: 'workflow-1',
        work_item_id: 'implementation-item',
        stage_name: 'implementation',
        role: 'developer',
        title: 'Implement change',
        is_orchestrator_task: false,
        input: { summary: 'old output' },
        rework_count: 0,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      workItemContinuityService: { recordAssessmentRequestedChanges } as never,
    });

    await service.requestTaskChanges(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-impl',
      {
        feedback: 'Tighten the invalid-input assertions',
      },
    );

    expect(recordAssessmentRequestedChanges).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'task-impl',
        work_item_id: 'implementation-item',
      }),
      client,
    );

    const reviewResetCall = client.query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string'
        && sql.includes('UPDATE workflow_work_items wi')
        && sql.includes("parent_work_item_id = $3")
        && sql.includes("COALESCE(assessment_task.metadata->>'task_kind', '') = 'assessment'")
        && sql.includes("metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state'"),
    ) as [string, unknown[]] | undefined;

    expect(reviewResetCall?.[1]).toEqual([
      'tenant-1',
      'workflow-1',
      'implementation-item',
    ]);

    const reopenCall = client.query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string'
        && sql.includes('UPDATE workflow_work_items')
        && sql.includes('SET column_id = $4')
        && sql.includes('completed_at = NULL')
        && sql.includes('id = $3')
        && sql.includes('(completed_at IS NOT NULL OR column_id = $5)'),
    ) as [string, unknown[]] | undefined;

    expect(reopenCall?.[1]).toEqual([
      'tenant-1',
      'workflow-1',
      'implementation-item',
      'planned',
      'done',
    ]);
  });


  it('clears completed_at when request-changes reopens a previously completed task', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-review-reopen',
              state: 'ready',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              role: 'developer',
              title: 'Implement change',
              is_orchestrator_task: false,
              input: { assessment_feedback: 'Address the reviewer findings' },
              metadata: { assessment_action: 'request_changes' },
              rework_count: 1,
              completed_at: null,
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
        id: 'task-review-reopen',
        state: 'completed',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'implementation',
        role: 'developer',
        title: 'Implement change',
        is_orchestrator_task: false,
        input: { summary: 'already shipped once' },
        rework_count: 0,
        completed_at: '2026-03-20T20:00:00.000Z',
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      workItemContinuityService: { recordAssessmentRequestedChanges: vi.fn() } as never,
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
      'task-review-reopen',
      {
        feedback: 'Address the reviewer findings',
      },
    );

    expect(result.state).toBe('ready');
    expect(result.completed_at).toBeNull();

    const updateCall = client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE tasks SET'),
    ) as [string, unknown[]] | undefined;

    expect(updateCall?.[0]).toContain('completed_at = NULL');
  });
});
