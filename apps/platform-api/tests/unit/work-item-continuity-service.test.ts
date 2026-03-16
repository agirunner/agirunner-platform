import { describe, expect, it, vi } from 'vitest';

import { WorkItemContinuityService } from '../../src/services/work-item-continuity-service.js';

describe('WorkItemContinuityService', () => {
  it('records next expected review actor after a task completion', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            current_checkpoint: 'implementation',
            owner_role: 'developer',
            next_expected_actor: null,
            next_expected_action: null,
            definition: {
              process_instructions: 'Developer implements and reviewer reviews.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              checkpoints: [{ name: 'implementation', goal: 'Implement work', human_gate: false }],
              review_rules: [{ from_role: 'developer', reviewed_by: 'reviewer', required: true }],
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
      matchedRuleType: 'review',
      nextExpectedActor: 'reviewer',
      nextExpectedAction: 'review',
      satisfiedReviewExpectation: false,
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1', 'work-item-1', 'implementation', 'reviewer', 'review', 0],
    );
  });

  it('increments work-item rework count and routes review rejection back to the source role', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            current_checkpoint: 'implementation',
            owner_role: 'developer',
            next_expected_actor: null,
            next_expected_action: null,
            definition: {
              process_instructions: 'Developer implements and reviewer reviews.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              checkpoints: [{ name: 'implementation', goal: 'Implement work', human_gate: false }],
              review_rules: [{
                from_role: 'developer',
                reviewed_by: 'reviewer',
                required: true,
                on_reject: { action: 'return_to_role', role: 'developer' },
              }],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    const service = new WorkItemContinuityService(pool as never);

    const result = await service.recordReviewRejected('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'developer',
      stage_name: 'implementation',
    });

    expect(result).toMatchObject({
      matchedRuleType: 'review',
      nextExpectedActor: 'developer',
      nextExpectedAction: 'rework',
      reworkDelta: 1,
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1', 'work-item-1', 'implementation', 'developer', 'rework', 1],
    );
  });

  it('falls back to the predecessor handoff role when a reviewer rejection has no direct on_reject rule', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'review',
            current_checkpoint: 'review',
            owner_role: 'reviewer',
            next_expected_actor: null,
            next_expected_action: null,
            definition: {
              process_instructions: 'Developer implements, reviewer reviews, rejected review returns to developer.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'review', label: 'Review' }] },
              checkpoints: [{ name: 'review', goal: 'Review the change', human_gate: false }],
              review_rules: [{
                from_role: 'developer',
                reviewed_by: 'reviewer',
                required: true,
                on_reject: { action: 'return_to_role', role: 'developer' },
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

    const result = await service.recordReviewRejected('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'reviewer',
      stage_name: 'review',
    });

    expect(result).toMatchObject({
      matchedRuleType: 'review',
      nextExpectedActor: 'developer',
      nextExpectedAction: 'rework',
      reworkDelta: 1,
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1', 'work-item-1', 'review', 'developer', 'rework', 1],
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
            current_checkpoint: 'implementation',
            owner_role: 'developer',
            next_expected_actor: 'reviewer',
            next_expected_action: 'review',
            definition: { process_instructions: 'Developer implements.' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    const service = new WorkItemContinuityService(pool as never);

    await service.clearReviewExpectation('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      stage_name: 'implementation',
    });

    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('next_expected_actor = NULL'),
      ['tenant-1', 'workflow-1', 'work-item-1', 'implementation'],
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
            current_checkpoint: 'requirements',
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
      ['tenant-1', 'workflow-1', 'work-item-1', 'requirements', 'human', 'approve', 0],
    );
  });

  it('flags when a task completion satisfies the active review expectation', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            current_checkpoint: 'implementation',
            owner_role: 'developer',
            next_expected_actor: 'reviewer',
            next_expected_action: 'review',
            definition: {
              process_instructions: 'Developer implements, reviewer approves, then QA validates.',
              roles: ['developer', 'reviewer', 'qa'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              checkpoints: [{ name: 'implementation', goal: 'Implementation is reviewed', human_gate: false }],
              handoff_rules: [{ from_role: 'reviewer', to_role: 'qa', required: true }],
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
      satisfiedReviewExpectation: true,
    });
  });
});
