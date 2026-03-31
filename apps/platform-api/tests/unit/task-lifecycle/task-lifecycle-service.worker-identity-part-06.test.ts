import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService worker identity + payload semantics', () => {
  it('reopens a completed work item into the active board column when request-changes resumes live work', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-review-active-reopen',
              state: 'ready',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              role: 'developer',
              title: 'Implement change',
              is_orchestrator_task: false,
              input: { assessment_feedback: 'Fix the reviewer findings and continue.' },
              metadata: { assessment_action: 'request_changes' },
              rework_count: 1,
              completed_at: null,
            }],
          };
        }
        if (
          sql.includes('FROM workflow_work_items wi')
          && sql.includes('JOIN workflows w')
          && sql.includes('JOIN playbooks p')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rowCount: 1,
            rows: [{
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              column_id: 'done',
              completed_at: new Date('2026-03-21T02:05:00Z'),
              definition: {
                roles: ['developer', 'reviewer'],
                lifecycle: 'planned',
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'In Progress' },
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1', 'active', 'done']);
          return {
            rowCount: 1,
            rows: [{
              id: 'work-item-1',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes('parent_work_item_id = $3')) {
          return { rows: [], rowCount: 0 };
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
              request_id: 'task-assessment-requested:task-review-active-reopen:Sat Mar 21 2026 02:10:00 GMT+0000 (Coordinated Universal Time)',
              reason: 'task.assessment_requested_changes',
              event_type: 'task.assessment_requested_changes',
              payload: { task_id: 'task-review-active-reopen' },
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
        if (sql.includes('COUNT(*)::int AS engaged_task_count')) {
          return { rows: [{ engaged_task_count: 1 }], rowCount: 1 };
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
        id: 'task-review-active-reopen',
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

    await service.requestTaskChanges(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-review-active-reopen',
      {
        feedback: 'Fix the reviewer findings and continue.',
      },
    );

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
      'work-item-1',
      'active',
      'done',
    ]);
  });


  it('keeps the current board column when request-changes reopens work in a paused workflow', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-review-paused-reopen',
              state: 'ready',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              role: 'developer',
              title: 'Implement change',
              is_orchestrator_task: false,
              input: { assessment_feedback: 'Fix the reviewer findings after resume.' },
              metadata: { assessment_action: 'request_changes' },
              rework_count: 1,
              completed_at: null,
            }],
          };
        }
        if (
          sql.includes('FROM workflow_work_items wi')
          && sql.includes('JOIN workflows w')
          && sql.includes('JOIN playbooks p')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rowCount: 1,
            rows: [{
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              column_id: 'done',
              completed_at: new Date('2026-03-21T02:05:00Z'),
              workflow_state: 'paused',
              workflow_metadata: { pause_requested_at: '2026-03-21T02:06:00Z' },
              definition: {
                roles: ['developer', 'reviewer'],
                lifecycle: 'planned',
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'In Progress' },
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1', 'done', 'done']);
          return {
            rowCount: 1,
            rows: [{
              id: 'work-item-1',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes('parent_work_item_id = $3')) {
          return { rows: [], rowCount: 0 };
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
              request_id: 'task-assessment-requested:task-review-paused-reopen:Sat Mar 21 2026 02:10:00 GMT+0000 (Coordinated Universal Time)',
              reason: 'task.assessment_requested_changes',
              event_type: 'task.assessment_requested_changes',
              payload: { task_id: 'task-review-paused-reopen' },
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
        if (sql.includes('COUNT(*)::int AS engaged_task_count')) {
          return { rows: [{ engaged_task_count: 1 }], rowCount: 1 };
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
        id: 'task-review-paused-reopen',
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

    await service.requestTaskChanges(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-review-paused-reopen',
      {
        feedback: 'Fix the reviewer findings after resume.',
      },
    );

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
      'work-item-1',
      'done',
      'done',
    ]);
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
      input: { assessment_feedback: 'Fix the failing assertions' },
      metadata: {
        assessment_action: 'request_changes',
        assessment_feedback: 'Fix the failing assertions',
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
});
