import { describe, expect, it, vi } from 'vitest';

import { WorkItemContinuityService } from '../../src/services/work-item-continuity-service.js';

describe('WorkItemContinuityService', () => {
  it('filters newer specialist handoffs by explicit orchestrator flag instead of role name', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ queued_at: new Date('2026-03-24T20:00:00Z') }],
          rowCount: 1,
        })
        .mockImplementationOnce(async (sql: string) => {
          expect(sql).toContain('COALESCE(t.is_orchestrator_task, FALSE) = FALSE');
          expect(sql).not.toContain("COALESCE(t.role, '') <> 'orchestrator'");
          return { rows: [{ has_newer_specialist_handoff: true }], rowCount: 1 };
        }),
    };

    const service = new WorkItemContinuityService(pool as never);
    const result = await (service as any).hasNewerSpecialistHandoffSinceActivation(
      'tenant-1',
      'workflow-1',
      'work-item-1',
      null,
      'activation-1',
      pool,
    );

    expect(result).toBe(true);
  });

  it('clears continuity to a neutral state when no config-driven routing exists', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            rework_count: 0,
            owner_role: 'developer',
            next_expected_actor: null,
            next_expected_action: null,
            definition: {
              process_instructions: 'Developer implements and leaves a clean handoff for the next step.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              stages: [{ name: 'implementation', goal: 'Build the work.' }],
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

    expect(result).toEqual({
      matchedRuleType: null,
      nextExpectedActor: null,
      nextExpectedAction: null,
      requiresHumanApproval: false,
      reworkDelta: 0,
      satisfiedAssessmentExpectation: false,
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1', 'work-item-1', null, null, 0],
    );
  });

  it('marks an active assessment expectation as satisfied when the expected assessor completes', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'review',
            rework_count: 1,
            owner_role: 'developer',
            next_expected_actor: 'reviewer',
            next_expected_action: 'assess',
            definition: {
              process_instructions: 'Reviewer assesses the output and either clears or reopens it.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              stages: [{ name: 'review', goal: 'Review the delivered work.' }],
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
      metadata: { task_kind: 'assessment' },
      input: { subject_task_id: 'task-developer-1', subject_revision: 1 },
    });

    expect(result).toEqual({
      matchedRuleType: null,
      nextExpectedActor: null,
      nextExpectedAction: null,
      requiresHumanApproval: false,
      reworkDelta: 0,
      satisfiedAssessmentExpectation: true,
    });
  });

  it('routes request-changes back to the linked subject role through assessment lineage inference', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'review',
            rework_count: 0,
            owner_role: 'developer',
            next_expected_actor: null,
            next_expected_action: null,
            definition: {
              process_instructions: 'Reviewer reopens the developer work when the output is not acceptable.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              stages: [{ name: 'review', goal: 'Review the delivered work.' }],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ role: 'developer' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ role: 'developer' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    const service = new WorkItemContinuityService(pool as never);
    const result = await service.recordAssessmentRequestedChanges('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      role: 'reviewer',
      stage_name: 'review',
      metadata: { task_kind: 'assessment' },
      input: { subject_task_id: 'task-developer-1', subject_revision: 3 },
    });

    expect(result).toMatchObject({
      matchedRuleType: 'assessment',
      nextExpectedActor: 'developer',
      nextExpectedAction: 'rework',
      requiresHumanApproval: false,
      reworkDelta: 1,
      satisfiedAssessmentExpectation: false,
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1', 'work-item-1', 'developer', 'rework', 1],
    );
  });

  it('clears an active assessment expectation explicitly', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'review',
            rework_count: 2,
            owner_role: 'developer',
            next_expected_actor: 'reviewer',
            next_expected_action: 'assess',
            definition: {
              process_instructions: 'Reviewer clears the output when the review is complete.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              stages: [{ name: 'review', goal: 'Review the delivered work.' }],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    const service = new WorkItemContinuityService(pool as never);
    const result = await service.clearAssessmentExpectation('tenant-1', {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      stage_name: 'review',
    });

    expect(result).toEqual({
      nextExpectedActor: null,
      nextExpectedAction: null,
      checkpointName: 'review',
    });
  });
});
