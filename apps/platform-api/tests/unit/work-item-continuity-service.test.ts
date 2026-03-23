import { describe, expect, it, vi } from 'vitest';

import { WorkItemContinuityService } from '../../src/services/work-item-continuity-service.js';

describe('WorkItemContinuityService', () => {
  it('records next expected assessment actor after a task completion', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            owner_role: 'developer',
            next_expected_actor: null,
            next_expected_action: null,
            definition: {
              process_instructions: 'Developer implements and reviewer assesses.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              checkpoints: [{ name: 'implementation', goal: 'Implement work', human_gate: false }],
              assessment_rules: [{ subject_role: 'developer', assessed_by: 'reviewer', required: true }],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    const service = new WorkItemContinuityService(pool as never);

    const result = await service.recordTaskCompleted('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'developer',
      stage_name: 'implementation',
    });

    expect(result).toMatchObject({
      matchedRuleType: 'assessment',
      nextExpectedActor: 'reviewer',
      nextExpectedAction: 'assess',
      satisfiedAssessmentExpectation: false,
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1', 'work-item-1', 'reviewer', 'assess', 0],
    );
  });

  it('records next expected handoff actor for planned intra-stage handoffs', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'drafting',
            owner_role: 'rework-product-strategist',
            next_expected_actor: null,
            next_expected_action: null,
            definition: {
              process_instructions: 'A strategist drafts and an editor refines in the same stage.',
              roles: ['rework-product-strategist', 'rework-technical-editor'],
              lifecycle: 'planned',
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              checkpoints: [{ name: 'drafting', goal: 'Drafting completes', human_gate: false }],
              stages: [
                {
                  name: 'drafting',
                  goal: 'Drafting completes',
                  involves: ['rework-product-strategist', 'rework-technical-editor'],
                },
              ],
              handoff_rules: [
                {
                  from_role: 'rework-product-strategist',
                  to_role: 'rework-technical-editor',
                  checkpoint: 'drafting',
                  required: true,
                },
              ],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    const service = new WorkItemContinuityService(pool as never);

    const result = await service.recordTaskCompleted('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'rework-product-strategist',
      stage_name: 'drafting',
    });

    expect(result).toMatchObject({
      matchedRuleType: 'handoff',
      nextExpectedActor: 'rework-technical-editor',
      nextExpectedAction: 'handoff',
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1', 'work-item-1', 'rework-technical-editor', 'handoff', 0],
    );
  });

  it('increments work-item rework count and routes assessment request-changes back to the source role', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            owner_role: 'developer',
            next_expected_actor: null,
            next_expected_action: null,
            definition: {
              process_instructions: 'Developer implements and reviewer assesses.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              checkpoints: [{ name: 'implementation', goal: 'Implement work', human_gate: false }],
              assessment_rules: [{
                subject_role: 'developer',
                assessed_by: 'reviewer',
                required: true,
                outcome_actions: {
                  request_changes: { action: 'route_to_role', role: 'developer' },
                },
              }],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    const service = new WorkItemContinuityService(pool as never);

    const result = await service.recordAssessmentRequestedChanges('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'developer',
      stage_name: 'implementation',
    });

    expect(result).toMatchObject({
      matchedRuleType: 'assessment',
      nextExpectedActor: 'developer',
      nextExpectedAction: 'rework',
      reworkDelta: 1,
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1', 'work-item-1', 'developer', 'rework', 1],
    );
  });

  it('falls back to the reopened subject role when request-changes has no direct rule', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'review',
            owner_role: 'reviewer',
            next_expected_actor: null,
            next_expected_action: null,
            definition: {
              process_instructions: 'Developer implements, reviewer assesses, request changes returns to developer.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'review', label: 'Review' }] },
              checkpoints: [{ name: 'review', goal: 'Review the change', human_gate: false }],
              assessment_rules: [{
                subject_role: 'developer',
                assessed_by: 'reviewer',
                required: true,
              }],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ role: 'reviewer' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    const service = new WorkItemContinuityService(pool as never);

    const result = await service.recordAssessmentRequestedChanges('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'developer',
      stage_name: 'review',
    });

    expect(result).toMatchObject({
      matchedRuleType: 'assessment',
      nextExpectedActor: 'developer',
      nextExpectedAction: 'rework',
      reworkDelta: 1,
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1', 'work-item-1', 'developer', 'rework', 1],
    );
  });

  it('routes request-changes back to the linked subject role when continuity is evaluated from an assessment task', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'review',
            owner_role: 'reviewer',
            next_expected_actor: null,
            next_expected_action: null,
            definition: {
              process_instructions: 'Assessors request changes against a linked subject task.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'review', label: 'Review' }] },
              checkpoints: [{ name: 'review', goal: 'Review the change', human_gate: false }],
              assessment_rules: [{
                subject_role: 'developer',
                assessed_by: 'reviewer',
                required: true,
              }],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ role: 'developer' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    const service = new WorkItemContinuityService(pool as never);

    const result = await service.recordAssessmentRequestedChanges('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'reviewer',
      stage_name: 'review',
      input: {
        subject_task_id: 'subject-task-1',
      },
      metadata: {
        task_kind: 'assessment',
      },
    });

    expect(result).toMatchObject({
      matchedRuleType: 'assessment',
      nextExpectedActor: 'developer',
      nextExpectedAction: 'rework',
      reworkDelta: 1,
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1', 'work-item-1', 'developer', 'rework', 1],
    );
  });

  it('clears continuity expectations after an approval path completes', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            owner_role: 'developer',
            next_expected_actor: 'reviewer',
            next_expected_action: 'assess',
            definition: { process_instructions: 'Developer implements.' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    const service = new WorkItemContinuityService(pool as never);

    await service.clearAssessmentExpectation('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      stage_name: 'implementation',
    });

    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('next_expected_actor = NULL'),
      ['tenant-1', 'workflow-1', 'work-item-1'],
    );
  });

  it('prioritizes checkpoint approval over downstream handoff routing', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'requirements',
            owner_role: 'product-manager',
            next_expected_actor: null,
            next_expected_action: null,
            definition: {
              process_instructions: 'Product manager defines requirements and architecture starts only after approval.',
              roles: ['product-manager', 'architect'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              checkpoints: [{ name: 'requirements', goal: 'Requirements are approved', human_gate: true }],
              handoff_rules: [{ from_role: 'product-manager', to_role: 'architect', required: true }],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    const service = new WorkItemContinuityService(pool as never);

    const result = await service.recordTaskCompleted('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'product-manager',
      stage_name: 'requirements',
    });

    expect(result).toMatchObject({
      matchedRuleType: 'approval',
      nextExpectedActor: 'human',
      nextExpectedAction: 'approve',
      requiresHumanApproval: true,
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1', 'work-item-1', 'human', 'approve', 0],
    );
  });

  it('flags when a task completion satisfies the active assessment expectation', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            owner_role: 'developer',
            next_expected_actor: 'reviewer',
            next_expected_action: 'assess',
            definition: {
              process_instructions: 'Developer implements, reviewer approves, then QA validates.',
              roles: ['developer', 'reviewer', 'qa'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              checkpoints: [{ name: 'implementation', goal: 'Implementation is reviewed', human_gate: false }],
              handoff_rules: [{ from_role: 'reviewer', to_role: 'qa', required: true }],
              lifecycle: 'ongoing',
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    const service = new WorkItemContinuityService(pool as never);

    const result = await service.recordTaskCompleted('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'reviewer',
      stage_name: 'implementation',
    });

    expect(result).toMatchObject({
      matchedRuleType: 'handoff',
      nextExpectedActor: 'qa',
      nextExpectedAction: 'handoff',
      satisfiedAssessmentExpectation: true,
    });
  });

  it('emits a continuity transition log when task completion updates the next expected step', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            owner_role: 'developer',
            next_expected_actor: 'reviewer',
            next_expected_action: 'assess',
            definition: {
              process_instructions: 'Developer implements and QA validates next.',
              roles: ['developer', 'qa'],
              board: { columns: [{ id: 'implementation', label: 'Implementation' }] },
              checkpoints: [{ name: 'implementation', goal: 'Implement work', human_gate: false }],
              handoff_rules: [{ from_role: 'developer', to_role: 'qa', required: true }],
              lifecycle: 'ongoing',
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };
    const logService = {
      insert: vi.fn(async () => undefined),
    };

    const service = new WorkItemContinuityService(pool as never, logService as never);

    await service.recordTaskCompleted('tenant-1', {
      id: 'task-1',
      title: 'Implement work',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'developer',
      stage_name: 'implementation',
    });

    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        source: 'platform',
        category: 'task_lifecycle',
        operation: 'work_item.continuity.task_completed',
        status: 'completed',
        workflowId: 'workflow-1',
        workItemId: 'work-item-1',
        taskId: 'task-1',
        role: 'developer',
        resourceType: 'work_item',
        resourceId: 'work-item-1',
        payload: expect.objectContaining({
          event: 'task_completed',
          stage_name: 'implementation',
          previous_next_expected_actor: 'reviewer',
          previous_next_expected_action: 'assess',
          next_expected_actor: 'qa',
          next_expected_action: 'handoff',
          matched_rule_type: 'handoff',
      satisfied_assessment_expectation: false,
          rework_delta: 0,
        }),
      }),
    );
    const payload = (logService.insert as ReturnType<typeof vi.fn>).mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('checkpoint_name');
  });

  it('clears planned-workflow continuity after assessor approval instead of routing qa on the review work item', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'review',
            rework_count: 1,
            owner_role: 'reviewer',
            next_expected_actor: 'reviewer',
            next_expected_action: 'assess',
            definition: {
              process_instructions: 'Reviewer approves before QA validates in the next planned stage.',
              roles: ['reviewer', 'qa'],
              board: { columns: [{ id: 'review', label: 'Review' }] },
              checkpoints: [
                { name: 'review', goal: 'Review is approved', human_gate: false },
                { name: 'verification', goal: 'QA validates the approved change', human_gate: false },
              ],
              handoff_rules: [{ from_role: 'reviewer', to_role: 'qa', checkpoint: 'review', required: true }],
              lifecycle: 'planned',
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    const service = new WorkItemContinuityService(pool as never);

    const result = await service.recordTaskCompleted('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'reviewer',
      stage_name: 'review',
    });

    expect(result).toMatchObject({
      matchedRuleType: null,
      nextExpectedActor: null,
      nextExpectedAction: null,
      satisfiedAssessmentExpectation: true,
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1', 'work-item-1', null, null, 0],
    );
  });

  it('emits a continuity transition log when assessment request-changes routes work back for rework', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'review',
            owner_role: 'reviewer',
            next_expected_actor: 'reviewer',
            next_expected_action: 'assess',
            definition: {
              process_instructions: 'Developer implements, reviewer requests changes back to developer on issues.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'review', label: 'Review' }] },
              checkpoints: [{ name: 'review', goal: 'Review the change', human_gate: false }],
              assessment_rules: [{
                subject_role: 'developer',
                assessed_by: 'reviewer',
                required: true,
                outcome_actions: {
                  request_changes: { action: 'route_to_role', role: 'developer' },
                },
              }],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };
    const logService = {
      insert: vi.fn(async () => undefined),
    };

    const service = new WorkItemContinuityService(pool as never, logService as never);

    await service.recordAssessmentRequestedChanges('tenant-1', {
      id: 'task-2',
      title: 'Review implementation',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'developer',
      stage_name: 'review',
    });

    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'work_item.continuity.assessment_requested_changes',
        payload: expect.objectContaining({
          event: 'assessment_requested_changes',
          stage_name: 'review',
          previous_next_expected_actor: 'reviewer',
          previous_next_expected_action: 'assess',
          next_expected_actor: 'developer',
          next_expected_action: 'rework',
          matched_rule_type: 'assessment',
          rework_delta: 1,
        }),
      }),
    );
    const payload = (logService.insert as ReturnType<typeof vi.fn>).mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('checkpoint_name');
  });

  it('emits a continuity transition log when assessment expectation is cleared after approval', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            owner_role: 'developer',
            next_expected_actor: 'reviewer',
            next_expected_action: 'assess',
            definition: { process_instructions: 'Developer implements.' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };
    const logService = {
      insert: vi.fn(async () => undefined),
    };

    const service = new WorkItemContinuityService(pool as never, logService as never);

    await service.clearAssessmentExpectation('tenant-1', {
      id: 'task-3',
      title: 'Approve implementation',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      stage_name: 'implementation',
      role: 'reviewer',
    });

    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'work_item.continuity.assessment_expectation_cleared',
        payload: expect.objectContaining({
          event: 'assessment_expectation_cleared',
          stage_name: 'implementation',
          previous_next_expected_actor: 'reviewer',
          previous_next_expected_action: 'assess',
          next_expected_actor: null,
          next_expected_action: null,
        }),
      }),
    );
    const payload = (logService.insert as ReturnType<typeof vi.fn>).mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('checkpoint_name');
  });

  it('persists allow-listed orchestrator finish-state continuity fields on the work item', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{
          next_expected_actor: 'human',
          next_expected_action: 'approve',
          metadata: {
            keep_me: true,
            orchestrator_finish_state: {
              status_summary: 'Waiting on release approval',
              next_expected_event: 'approval.received',
            },
          },
        }],
      }),
    };

    const service = new WorkItemContinuityService(pool as never);

    const result = await service.persistOrchestratorFinishState('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'orchestrator',
      stage_name: 'release',
    }, {
      next_expected_actor: 'human',
      next_expected_action: 'approve',
      status_summary: 'Waiting on release approval',
      next_expected_event: 'approval.received',
      blocked_on: ['release manager sign-off'],
      active_subordinate_tasks: ['task-review-1'],
    });

    expect(result).toEqual({
      nextExpectedActor: 'human',
      nextExpectedAction: 'approve',
      continuity: {
        status_summary: 'Waiting on release approval',
        next_expected_event: 'approval.received',
        blocked_on: ['release manager sign-off'],
        active_subordinate_tasks: ['task-review-1'],
      },
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      [
        'tenant-1',
        'workflow-1',
        'work-item-1',
        'human',
        'approve',
        {
          orchestrator_finish_state: {
            status_summary: 'Waiting on release approval',
            next_expected_event: 'approval.received',
            blocked_on: ['release manager sign-off'],
            active_subordinate_tasks: ['task-review-1'],
          },
        },
      ],
    );
  });

  it('preserves canonical routing when orchestrator finish-state metadata proposes a different actor', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{
          next_expected_actor: 'human',
          next_expected_action: 'approve',
          metadata: {},
        }],
      }),
    };

    const service = new WorkItemContinuityService(pool as never);

    const result = await service.persistOrchestratorFinishState('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'orchestrator',
      stage_name: 'approval-gate',
    }, {
      next_expected_actor: 'human-review-gate',
      next_expected_action: 'review the approval-gate artifacts and record the requested gate decision',
      status_summary: 'Approval gate is waiting on the next human decision.',
    });

    expect(result).toEqual({
      nextExpectedActor: 'human',
      nextExpectedAction: 'approve',
      continuity: {
        next_expected_event: null,
        status_summary: 'Approval gate is waiting on the next human decision.',
      },
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      [
        'tenant-1',
        'workflow-1',
        'work-item-1',
        'human',
        'approve',
        expect.objectContaining({
          orchestrator_finish_state: expect.objectContaining({
            status_summary: 'Approval gate is waiting on the next human decision.',
          }),
        }),
      ],
    );
  });

  it('skips stale orchestrator finish-state writes once a newer specialist handoff exists', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            next_expected_actor: 'reviewer',
            next_expected_action: 'assess',
            parent_work_item_id: 'implementation-item',
            metadata: {
              keep_me: true,
              orchestrator_finish_state: {
                status_summary: 'Implementation is ready for the next assessment pass.',
                next_expected_event: 'task.output_pending_assessment',
              },
            },
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ queued_at: new Date('2026-03-21T16:52:26.000Z') }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ has_newer_specialist_handoff: true }],
        }),
    };

    const service = new WorkItemContinuityService(pool as never);

    const result = await service.persistOrchestratorFinishState('tenant-1', {
      id: 'orch-task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'review-item',
      activation_id: 'activation-1',
      role: 'orchestrator',
      stage_name: 'review',
    }, {
      next_expected_actor: 'developer',
      next_expected_action: 'rework',
      status_summary: 'Route the first assessment request-changes outcome back to implementation.',
      next_expected_event: 'task.handoff_submitted',
    });

    expect(result).toEqual({
      nextExpectedActor: 'reviewer',
      nextExpectedAction: 'assess',
      continuity: {
        status_summary: 'Implementation is ready for the next assessment pass.',
        next_expected_event: 'task.output_pending_assessment',
      },
    });
    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      expect.anything(),
    );
  });
});
