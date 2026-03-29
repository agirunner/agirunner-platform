import { describe, expect, it, vi } from 'vitest';

import {
  buildReplayConflictOperatorGuidance,
  GuidedClosureRecoveryHelpersService,
} from '../../src/services/guided-closure/recovery-helpers.js';

const identity = {
  tenantId: 'tenant-1',
  keyPrefix: 'k1',
  scope: 'agent',
} as const;

const definition = {
  lifecycle: 'planned',
  board: {
    columns: [
      { id: 'planned', label: 'Planned' },
      { id: 'done', label: 'Done', is_terminal: true },
    ],
  },
  stages: [{ name: 'review', goal: 'Review the work' }],
};

describe('GuidedClosureRecoveryHelpersService', () => {
  it('formats replay-conflict guidance in operator-readable English when a prior attempt request_id was reused', () => {
    const guidance = buildReplayConflictOperatorGuidance({
      submitted_request_id: 'req-r2',
      submitted_task_rework_count: 3,
      persisted_handoff: {
        id: 'handoff-r2',
        request_id: 'req-r2',
        task_id: 'task-1',
        task_rework_count: 2,
        created_at: '2026-03-16T12:00:00.000Z',
        summary: 'Persisted handoff for revision 2.',
        completion_state: 'full',
        decision_state: null,
      },
      current_attempt_handoff: {
        id: 'handoff-r3',
        request_id: 'req-r3',
        task_id: 'task-1',
        task_rework_count: 3,
        created_at: '2026-03-17T12:00:00.000Z',
        summary: 'Persisted handoff for revision 3.',
        completion_state: 'full',
        decision_state: null,
      },
      replay_conflict_fields: [],
    });

    expect(guidance).toMatchObject({
      conflict_source: 'stale_request_id_from_prior_attempt',
      task_contract_satisfied_by_persisted_handoff: true,
      conflicting_request_ids: {
        submitted_request_id: 'req-r2',
        persisted_request_id: 'req-r2',
        current_attempt_request_id: 'req-r3',
      },
    });
    expect(guidance.context_summary).toContain('rework 3');
    expect(guidance.context_summary).toContain('rework 2');
    expect(guidance.work_so_far).toContain('already has persisted handoff "handoff-r3"');
    expect(guidance.work_so_far).toContain('Settle the task or escalation from that handoff');
  });

  it('updates task input before retrying corrected work', async () => {
    const taskService = {
      updateTaskInput: vi.fn(async () => ({ id: 'task-1' })),
      retryTask: vi.fn(async () => ({ id: 'task-1', state: 'ready' })),
      reassignTask: vi.fn(),
    };
    const service = new GuidedClosureRecoveryHelpersService({
      pool: {} as never,
      eventService: { emit: vi.fn() } as never,
      taskService: taskService as never,
      workflowControlService: {
        completeWorkItem: vi.fn(),
        completeWorkflow: vi.fn(),
      } as never,
    });

    const result = await service.rerunTaskWithCorrectedBrief(identity as never, 'task-1', {
      request_id: 'retry-1',
      corrected_input: { brief: 'Use the corrected reviewer contract.' },
    }, {} as never);

    expect(taskService.updateTaskInput).toHaveBeenCalledWith(
      'tenant-1',
      'task-1',
      { brief: 'Use the corrected reviewer contract.' },
      {} as never,
    );
    expect(taskService.retryTask).toHaveBeenCalledWith(
      identity,
      'task-1',
      { force: true },
      {} as never,
    );
    expect(result).toEqual({ id: 'task-1', state: 'ready' });
  });

  it('delegates stale owner recovery to task reassignment', async () => {
    const taskService = {
      updateTaskInput: vi.fn(),
      retryTask: vi.fn(),
      reassignTask: vi.fn(async () => ({ id: 'task-1', state: 'ready' })),
    };
    const service = new GuidedClosureRecoveryHelpersService({
      pool: {} as never,
      eventService: { emit: vi.fn() } as never,
      taskService: taskService as never,
      workflowControlService: {
        completeWorkItem: vi.fn(),
        completeWorkflow: vi.fn(),
      } as never,
    });

    const result = await service.reattachOrReplaceStaleOwner(identity as never, 'task-1', {
      request_id: 'reassign-1',
      reason: 'The prior owner is stale.',
      preferred_worker_id: 'worker-1',
    }, {} as never);

    expect(taskService.reassignTask).toHaveBeenCalledWith(
      identity,
      'task-1',
      {
        preferred_agent_id: undefined,
        reason: 'The prior owner is stale.',
        preferred_worker_id: 'worker-1',
      },
      {} as never,
    );
    expect(result).toEqual({ id: 'task-1', state: 'ready' });
  });

  it('delegates close-with-callouts to work item completion', async () => {
    const workflowControlService = {
      completeWorkItem: vi.fn(async () => ({ id: 'wi-1', completed_at: '2026-03-24T10:00:00.000Z' })),
      completeWorkflow: vi.fn(),
    };
    const service = new GuidedClosureRecoveryHelpersService({
      pool: {} as never,
      eventService: { emit: vi.fn() } as never,
      taskService: {
        updateTaskInput: vi.fn(),
        retryTask: vi.fn(),
        reassignTask: vi.fn(),
      } as never,
      workflowControlService: workflowControlService as never,
    });

    await service.closeWorkItemWithCallouts(identity as never, 'workflow-1', 'wi-1', {
      waived_steps: [{ code: 'brand_review', reason: 'Primary editorial review covered the risk.' }],
    }, {} as never);

    expect(workflowControlService.completeWorkItem).toHaveBeenCalledWith(
      identity,
      'workflow-1',
      'wi-1',
      {
        acting_task_id: null,
        completion_callouts: {
          residual_risks: [],
          unmet_preferred_expectations: [],
          waived_steps: [{ code: 'brand_review', reason: 'Primary editorial review covered the risk.' }],
          unresolved_advisory_items: [],
          completion_notes: null,
        },
      },
      {} as never,
    );
  });

  it('merges waived preferred steps into work item callouts', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-1',
              workflow_id: 'workflow-1',
              stage_name: 'review',
              column_id: 'planned',
              completed_at: null,
              metadata: {},
              completion_callouts: {
                residual_risks: [],
                unmet_preferred_expectations: [],
                waived_steps: [{ code: 'security_review', reason: 'Security approved in an earlier pass.' }],
                unresolved_advisory_items: [],
                completion_notes: null,
              },
              updated_at: new Date('2026-03-24T10:00:00Z'),
              definition,
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes('completion_callouts = $4::jsonb')) {
          expect(params?.[3]).toEqual({
            residual_risks: [],
            unmet_preferred_expectations: [],
            waived_steps: [
              { code: 'security_review', reason: 'Security approved in an earlier pass.' },
              { code: 'brand_review', reason: 'Primary editorial review covered the risk.' },
            ],
            unresolved_advisory_items: [],
            completion_notes: null,
          });
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-1',
              workflow_id: 'workflow-1',
              stage_name: 'review',
              column_id: 'planned',
              completed_at: null,
              metadata: {},
              completion_callouts: params?.[3],
              updated_at: new Date('2026-03-24T10:05:00Z'),
              definition,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new GuidedClosureRecoveryHelpersService({
      pool: {} as never,
      eventService: eventService as never,
      taskService: {
        updateTaskInput: vi.fn(),
        retryTask: vi.fn(),
        reassignTask: vi.fn(),
      } as never,
      workflowControlService: {
        completeWorkItem: vi.fn(),
        completeWorkflow: vi.fn(),
      } as never,
    });

    const result = await service.waivePreferredStep(identity as never, 'workflow-1', 'wi-1', {
      code: 'brand_review',
      reason: 'Primary editorial review covered the risk.',
    }, client as never);

    expect(result.completion_callouts.waived_steps).toEqual([
      { code: 'security_review', reason: 'Security approved in an earlier pass.' },
      { code: 'brand_review', reason: 'Primary editorial review covered the risk.' },
    ]);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.updated',
        data: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
        }),
      }),
      client,
    );
  });

  it('reopens a completed work item for missing handoff recovery', async () => {
    const definitionWithActiveColumn = {
      ...definition,
      board: {
        columns: [
          { id: 'planned', label: 'Planned' },
          { id: 'active', label: 'Active' },
          { id: 'done', label: 'Done', is_terminal: true },
        ],
      },
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-1',
              workflow_id: 'workflow-1',
              stage_name: 'review',
              column_id: 'done',
              completed_at: new Date('2026-03-24T10:00:00Z'),
              metadata: { orchestrator_finish_state: { finished: true } },
              completion_callouts: {},
              updated_at: new Date('2026-03-24T10:00:00Z'),
              definition: definitionWithActiveColumn,
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes('completed_at = NULL')) {
          expect(params?.[3]).toBe('active');
          expect(params?.[4]).toBe('The predecessor exited without a full handoff.');
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-1',
              workflow_id: 'workflow-1',
              stage_name: 'review',
              column_id: 'active',
              completed_at: null,
              metadata: { guided_closure: { last_reopen_reason: 'The predecessor exited without a full handoff.' } },
              completion_callouts: {},
              updated_at: new Date('2026-03-24T10:06:00Z'),
              definition: definitionWithActiveColumn,
            }],
          };
        }
        if (
          sql.includes('UPDATE workflow_output_descriptors')
          && sql.includes("SET state = 'superseded'")
          && sql.includes('work_item_id = $3')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-1']);
          return {
            rowCount: 1,
            rows: [{ id: 'descriptor-1' }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new GuidedClosureRecoveryHelpersService({
      pool: {} as never,
      eventService: eventService as never,
      taskService: {
        updateTaskInput: vi.fn(),
        retryTask: vi.fn(),
        reassignTask: vi.fn(),
      } as never,
      workflowControlService: {
        completeWorkItem: vi.fn(),
        completeWorkflow: vi.fn(),
      } as never,
    });

    const result = await service.reopenWorkItemForMissingHandoff(identity as never, 'workflow-1', 'wi-1', {
      reason: 'The predecessor exited without a full handoff.',
    }, client as never);

    expect(result.column_id).toBe('active');
    expect(result.completed_at).toBeNull();
    expect(eventService.emit).toHaveBeenCalledTimes(3);
    const supersedeCall = client.query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string'
        && sql.includes('UPDATE workflow_output_descriptors')
        && sql.includes("SET state = 'superseded'")
        && sql.includes('work_item_id = $3'),
    ) as [string, unknown[]] | undefined;

    expect(supersedeCall?.[1]).toEqual(['tenant-1', 'workflow-1', 'wi-1']);
  });

  it('preserves the current board column when missing-handoff recovery reopens a paused workflow work item', async () => {
    const definitionWithActiveColumn = {
      ...definition,
      board: {
        columns: [
          { id: 'planned', label: 'Planned' },
          { id: 'active', label: 'Active' },
          { id: 'done', label: 'Done', is_terminal: true },
        ],
      },
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-1',
              workflow_id: 'workflow-1',
              stage_name: 'review',
              column_id: 'done',
              completed_at: new Date('2026-03-24T10:00:00Z'),
              metadata: { orchestrator_finish_state: { finished: true } },
              completion_callouts: {},
              updated_at: new Date('2026-03-24T10:00:00Z'),
              definition: definitionWithActiveColumn,
              workflow_state: 'paused',
              workflow_metadata: { pause_requested_at: '2026-03-24T10:01:00Z' },
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes('completed_at = NULL')) {
          expect(params?.[3]).toBe('done');
          expect(params?.[4]).toBe('The predecessor exited without a full handoff.');
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-1',
              workflow_id: 'workflow-1',
              stage_name: 'review',
              column_id: 'done',
              completed_at: null,
              metadata: { guided_closure: { last_reopen_reason: 'The predecessor exited without a full handoff.' } },
              completion_callouts: {},
              updated_at: new Date('2026-03-24T10:06:00Z'),
              definition: definitionWithActiveColumn,
              workflow_state: 'paused',
              workflow_metadata: { pause_requested_at: '2026-03-24T10:01:00Z' },
            }],
          };
        }
        if (
          sql.includes('UPDATE workflow_output_descriptors')
          && sql.includes("SET state = 'superseded'")
          && sql.includes('work_item_id = $3')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-1']);
          return {
            rowCount: 1,
            rows: [{ id: 'descriptor-1' }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new GuidedClosureRecoveryHelpersService({
      pool: {} as never,
      eventService: eventService as never,
      taskService: {
        updateTaskInput: vi.fn(),
        retryTask: vi.fn(),
        reassignTask: vi.fn(),
      } as never,
      workflowControlService: {
        completeWorkItem: vi.fn(),
        completeWorkflow: vi.fn(),
      } as never,
    });

    const result = await service.reopenWorkItemForMissingHandoff(identity as never, 'workflow-1', 'wi-1', {
      reason: 'The predecessor exited without a full handoff.',
    }, client as never);

    expect(result.column_id).toBe('done');
    expect(result.completed_at).toBeNull();
  });

  it('preserves the current board column when missing-handoff recovery reopens a cancelled workflow work item', async () => {
    const definitionWithActiveColumn = {
      ...definition,
      board: {
        columns: [
          { id: 'planned', label: 'Planned' },
          { id: 'active', label: 'Active' },
          { id: 'done', label: 'Done', is_terminal: true },
        ],
      },
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-1',
              workflow_id: 'workflow-1',
              stage_name: 'review',
              column_id: 'done',
              completed_at: new Date('2026-03-24T10:00:00Z'),
              metadata: { orchestrator_finish_state: { finished: true } },
              completion_callouts: {},
              updated_at: new Date('2026-03-24T10:00:00Z'),
              definition: definitionWithActiveColumn,
              workflow_state: 'cancelled',
              workflow_metadata: {},
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes('completed_at = NULL')) {
          expect(params?.[3]).toBe('done');
          expect(params?.[4]).toBe('The predecessor exited without a full handoff.');
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-1',
              workflow_id: 'workflow-1',
              stage_name: 'review',
              column_id: 'done',
              completed_at: null,
              metadata: { guided_closure: { last_reopen_reason: 'The predecessor exited without a full handoff.' } },
              completion_callouts: {},
              updated_at: new Date('2026-03-24T10:06:00Z'),
              definition: definitionWithActiveColumn,
              workflow_state: 'cancelled',
              workflow_metadata: {},
            }],
          };
        }
        if (
          sql.includes('UPDATE workflow_output_descriptors')
          && sql.includes("SET state = 'superseded'")
          && sql.includes('work_item_id = $3')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-1']);
          return {
            rowCount: 1,
            rows: [{ id: 'descriptor-1' }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new GuidedClosureRecoveryHelpersService({
      pool: {} as never,
      eventService: eventService as never,
      taskService: {
        updateTaskInput: vi.fn(),
        retryTask: vi.fn(),
        reassignTask: vi.fn(),
      } as never,
      workflowControlService: {
        completeWorkItem: vi.fn(),
        completeWorkflow: vi.fn(),
      } as never,
    });

    const result = await service.reopenWorkItemForMissingHandoff(identity as never, 'workflow-1', 'wi-1', {
      reason: 'The predecessor exited without a full handoff.',
    }, client as never);

    expect(result.column_id).toBe('done');
    expect(result.completed_at).toBeNull();
  });
});
