import { describe, expect, it, vi } from 'vitest';

import { GuidedClosureRecoveryHelpersService } from '../../src/services/guided-closure/recovery-helpers.js';

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
              definition,
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes('completed_at = NULL')) {
          expect(params?.[3]).toBe('planned');
          expect(params?.[4]).toBe('The predecessor exited without a full handoff.');
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-1',
              workflow_id: 'workflow-1',
              stage_name: 'review',
              column_id: 'planned',
              completed_at: null,
              metadata: { guided_closure: { last_reopen_reason: 'The predecessor exited without a full handoff.' } },
              completion_callouts: {},
              updated_at: new Date('2026-03-24T10:06:00Z'),
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

    const result = await service.reopenWorkItemForMissingHandoff(identity as never, 'workflow-1', 'wi-1', {
      reason: 'The predecessor exited without a full handoff.',
    }, client as never);

    expect(result.column_id).toBe('planned');
    expect(result.completed_at).toBeNull();
    expect(eventService.emit).toHaveBeenCalledTimes(3);
  });
});
