import { describe, expect, it, vi } from 'vitest';

import {
  buildReplayConflictOperatorGuidance,
  GuidedClosureRecoveryHelpersService,
} from '../../../../src/services/guided-closure/recovery-helpers.js';
import { identity } from './fixtures.js';

describe('GuidedClosureRecoveryHelpersService guidance and delegation', () => {
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
});
