import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../src/errors/domain-errors.js';
import { HandoffService } from '../../../src/services/handoff-service/handoff-service.js';
import { logSafetynetTriggered } from '../../../src/services/safetynet/logging.js';
import {
  PLATFORM_HANDOFF_ORCHESTRATOR_PROGRESS_GUIDANCE_ID,
  mustGetSafetynetEntry,
} from '../../../src/services/safetynet/registry.js';
import { makeTaskRow } from './handoff-service.fixtures.js';

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: vi.fn(),
}));

const ORCHESTRATOR_PROGRESS_GUIDANCE_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_HANDOFF_ORCHESTRATOR_PROGRESS_GUIDANCE_ID,
);

describe('HandoffService orchestrator progress guidance', () => {
  beforeEach(() => {
    vi.mocked(logSafetynetTriggered).mockReset();
  });

  it('rejects an orchestrator handoff that leaves closeable work parked with no active specialist tasks', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            id: 'task-orchestrator',
            role: 'orchestrator',
            stage_name: 'verify',
            work_item_id: null,
            is_orchestrator_task: true,
            metadata: { task_kind: 'orchestrator' },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'work-item-verify-1',
              stage_name: 'verify',
              completed_at: null,
              created_at: new Date('2026-04-02T10:31:16Z'),
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'task-qa-1',
              role: 'QA Reviewer',
              state: 'completed',
              work_item_id: 'work-item-verify-1',
              is_orchestrator_task: false,
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [
            {
              work_item_id: 'work-item-verify-1',
              status: 'open',
              closure_effect: 'advisory',
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            definition: {
              lifecycle: 'planned',
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              stages: [{ name: 'verify', goal: 'Verify the work' }],
            },
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.submitTaskHandoff('tenant-1', 'task-orchestrator', {
        request_id: 'handoff:task-orchestrator:r0:verify-parked',
        summary: 'Verify remains advisory only; route release decision later.',
        completion: 'full',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Focused work can still progress now. Perform the required workflow mutation before submit_handoff.',
      details: {
        reason_code: 'orchestrator_progress_mutation_required',
        recoverable: true,
        recovery_hint: 'progress_or_close_work_item_before_handoff',
        safetynet_behavior_id: ORCHESTRATOR_PROGRESS_GUIDANCE_SAFETYNET.id,
        recovery: {
          status: 'action_required',
          reason: 'orchestrator_progress_mutation_required',
          action: 'progress_or_close_work_item_before_handoff',
          target_type: 'work_item',
          target_id: 'work-item-verify-1',
        },
        closure_context: expect.objectContaining({
          work_item_can_close_now: true,
          workflow_can_close_now: false,
          closure_readiness: 'can_close_with_callouts',
          open_specialist_task_count: 0,
          work_item_id: 'work-item-verify-1',
          stage_name: 'verify',
        }),
      },
    });

    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO task_handoffs'),
      expect.anything(),
    );
    expect(logSafetynetTriggered).toHaveBeenCalledWith(
      ORCHESTRATOR_PROGRESS_GUIDANCE_SAFETYNET,
      'orchestrator handoff rejected because workflow progress could still be applied in the same activation',
      expect.objectContaining({
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-verify-1',
        task_id: 'task-orchestrator',
        stage_name: 'verify',
        reason_code: 'orchestrator_progress_mutation_required',
        work_item_can_close_now: true,
      }),
    );
  });

  it('allows an orchestrator handoff when active specialist work still exists elsewhere in the workflow', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            id: 'task-orchestrator',
            role: 'orchestrator',
            stage_name: 'review',
            work_item_id: null,
            is_orchestrator_task: true,
            metadata: { task_kind: 'orchestrator' },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'work-item-review-1',
              stage_name: 'review',
              completed_at: null,
              created_at: new Date('2026-04-02T10:35:00Z'),
            },
            {
              id: 'work-item-implement-1',
              stage_name: 'implement',
              completed_at: null,
              created_at: new Date('2026-04-02T10:31:16Z'),
            },
          ],
          rowCount: 2,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'task-dev-1',
              role: 'Software Developer',
              state: 'in_progress',
              work_item_id: 'work-item-implement-1',
              is_orchestrator_task: false,
            },
            {
              id: 'task-review-1',
              role: 'Code Reviewer',
              state: 'completed',
              work_item_id: 'work-item-review-1',
              is_orchestrator_task: false,
            },
          ],
          rowCount: 2,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            definition: {
              lifecycle: 'planned',
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              stages: [
                { name: 'implement', goal: 'Implement the change' },
                { name: 'review', goal: 'Review the change' },
              ],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            task_id: 'task-orchestrator',
            task_rework_count: 0,
            request_id: 'handoff:task-orchestrator:r0:waiting',
            role: 'orchestrator',
            team_name: null,
            stage_name: 'review',
            sequence: 0,
            summary: 'Waiting on implement rework.',
            completion: 'full',
            completion_state: 'full',
            resolution: null,
            decision_state: null,
            closure_effect: null,
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: [],
            known_risks: [],
            recommended_next_actions: [],
            waived_steps: [],
            completion_callouts: {},
            successor_context: null,
            role_data: { task_kind: 'orchestrator' },
            subject_ref: null,
            subject_revision: null,
            outcome_action_applied: null,
            branch_id: null,
            artifact_ids: [],
            created_at: new Date('2026-04-02T10:37:09Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.submitTaskHandoff('tenant-1', 'task-orchestrator', {
        request_id: 'handoff:task-orchestrator:r0:waiting',
        summary: 'Waiting on implement rework.',
        completion: 'full',
      }),
    ).resolves.toEqual(expect.objectContaining({
      id: 'handoff-1',
      role: 'orchestrator',
      summary: 'Waiting on implement rework.',
    }));

    expect(logSafetynetTriggered).not.toHaveBeenCalled();
  });

  it('allows a queued replay handoff when the immediate successor stage already has active specialist work', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            id: 'task-orchestrator',
            role: 'orchestrator',
            stage_name: 'reproduce',
            work_item_id: 'work-item-reproduce-1',
            is_orchestrator_task: true,
            metadata: { task_kind: 'orchestrator' },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'work-item-implement-1',
              stage_name: 'implement',
              completed_at: null,
              created_at: new Date('2026-04-02T11:36:30Z'),
            },
            {
              id: 'work-item-reproduce-1',
              stage_name: 'reproduce',
              completed_at: new Date('2026-04-02T11:36:29Z'),
              created_at: new Date('2026-04-02T11:33:19Z'),
            },
          ],
          rowCount: 2,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'task-dev-1',
              role: 'Software Developer',
              state: 'in_progress',
              work_item_id: 'work-item-implement-1',
              is_orchestrator_task: false,
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            definition: {
              lifecycle: 'planned',
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              stages: [
                { name: 'reproduce', goal: 'Reproduce the bug' },
                { name: 'implement', goal: 'Implement the fix' },
                { name: 'review', goal: 'Review the fix' },
              ],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-reproduce-1',
            task_id: 'task-orchestrator',
            task_rework_count: 0,
            request_id: 'handoff:task-orchestrator:r0:wait-on-implement',
            role: 'orchestrator',
            team_name: null,
            stage_name: 'reproduce',
            sequence: 0,
            summary: 'Queued replay confirmed implement work is already active.',
            completion: 'full',
            completion_state: 'full',
            resolution: null,
            decision_state: null,
            closure_effect: null,
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: [],
            known_risks: [],
            recommended_next_actions: [],
            waived_steps: [],
            completion_callouts: {},
            successor_context: null,
            role_data: { task_kind: 'orchestrator' },
            subject_ref: null,
            subject_revision: null,
            outcome_action_applied: null,
            branch_id: null,
            artifact_ids: [],
            created_at: new Date('2026-04-02T11:38:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.submitTaskHandoff('tenant-1', 'task-orchestrator', {
        request_id: 'handoff:task-orchestrator:r0:wait-on-implement',
        summary: 'Queued replay confirmed implement work is already active.',
        completion: 'full',
      }),
    ).resolves.toEqual(expect.objectContaining({
      id: 'handoff-1',
      role: 'orchestrator',
      summary: 'Queued replay confirmed implement work is already active.',
    }));

    expect(logSafetynetTriggered).not.toHaveBeenCalled();
  });

  it('rejects a handoff-only endgame when the immediate successor stage can start now', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            id: 'task-orchestrator',
            role: 'orchestrator',
            stage_name: 'implement',
            work_item_id: 'work-item-implement-1',
            is_orchestrator_task: true,
            metadata: { task_kind: 'orchestrator' },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'work-item-implement-1',
              stage_name: 'implement',
              completed_at: new Date('2026-04-02T11:17:59Z'),
              created_at: new Date('2026-04-02T11:14:08Z'),
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'task-dev-1',
              role: 'Software Developer',
              state: 'completed',
              work_item_id: 'work-item-implement-1',
              is_orchestrator_task: false,
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            definition: {
              lifecycle: 'planned',
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              stages: [
                { name: 'reproduce', goal: 'Reproduce the bug' },
                { name: 'implement', goal: 'Implement the fix' },
                { name: 'review', goal: 'Review the fix' },
              ],
            },
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.submitTaskHandoff('tenant-1', 'task-orchestrator', {
        request_id: 'handoff:task-orchestrator:r0:route-review',
        summary: 'Implement fix work is complete.',
        completion: 'full',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Successor stage can start now. Route it before submit_handoff.',
      details: {
        reason_code: 'orchestrator_successor_stage_progress_required',
        recoverable: true,
        recovery_hint: 'route_successor_stage_before_handoff',
        safetynet_behavior_id: ORCHESTRATOR_PROGRESS_GUIDANCE_SAFETYNET.id,
        recovery: {
          status: 'action_required',
          reason: 'orchestrator_successor_stage_progress_required',
          action: 'route_successor_stage_before_handoff',
          target_type: 'workflow',
          target_id: 'workflow-1',
        },
        closure_context: expect.objectContaining({
          workflow_can_close_now: false,
          work_item_can_close_now: false,
          next_stage_can_start_now: true,
          next_stage_name: 'review',
          stage_name: 'implement',
          work_item_id: 'work-item-implement-1',
        }),
      },
    });

    expect(logSafetynetTriggered).toHaveBeenCalledWith(
      ORCHESTRATOR_PROGRESS_GUIDANCE_SAFETYNET,
      'orchestrator handoff rejected because workflow progress could still be applied in the same activation',
      expect.objectContaining({
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-implement-1',
        task_id: 'task-orchestrator',
        stage_name: 'implement',
        reason_code: 'orchestrator_successor_stage_progress_required',
        next_stage_name: 'review',
      }),
    );
  });

  it('rejects a queued replay handoff by focusing the already-open successor work item when that successor can now close and route onward', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            id: 'task-orchestrator',
            role: 'orchestrator',
            stage_name: 'reproduce',
            work_item_id: 'work-item-reproduce-1',
            is_orchestrator_task: true,
            metadata: { task_kind: 'orchestrator' },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'work-item-implement-1',
              stage_name: 'implement',
              completed_at: null,
              created_at: new Date('2026-04-02T11:36:30Z'),
            },
            {
              id: 'work-item-reproduce-1',
              stage_name: 'reproduce',
              completed_at: new Date('2026-04-02T11:36:29Z'),
              created_at: new Date('2026-04-02T11:33:19Z'),
            },
          ],
          rowCount: 2,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'task-dev-1',
              role: 'Software Developer',
              state: 'completed',
              work_item_id: 'work-item-implement-1',
              is_orchestrator_task: false,
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            definition: {
              lifecycle: 'planned',
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              stages: [
                { name: 'reproduce', goal: 'Reproduce the bug' },
                { name: 'implement', goal: 'Implement the fix' },
                { name: 'review', goal: 'Review the fix' },
              ],
            },
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.submitTaskHandoff('tenant-1', 'task-orchestrator', {
        request_id: 'handoff:task-orchestrator:r0:queued-replay',
        summary: 'Queued replay inspected the already-open implement work.',
        completion: 'full',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Focused work can close now and its immediate successor stage can start after closure. Complete the work item, route the successor stage, then submit_handoff.',
      details: {
        reason_code: 'orchestrator_close_then_successor_stage_progress_required',
        recoverable: true,
        recovery_hint: 'complete_work_item_then_route_successor_stage_before_handoff',
        safetynet_behavior_id: ORCHESTRATOR_PROGRESS_GUIDANCE_SAFETYNET.id,
        recovery: {
          status: 'action_required',
          reason: 'orchestrator_close_then_successor_stage_progress_required',
          action: 'complete_work_item_then_route_successor_stage_before_handoff',
          target_type: 'workflow',
          target_id: 'workflow-1',
        },
        closure_context: expect.objectContaining({
          workflow_can_close_now: false,
          work_item_can_close_now: true,
          close_then_successor_stage_can_start_now: true,
          next_stage_name: 'review',
          stage_name: 'implement',
          work_item_id: 'work-item-implement-1',
        }),
      },
    });

    expect(logSafetynetTriggered).toHaveBeenCalledWith(
      ORCHESTRATOR_PROGRESS_GUIDANCE_SAFETYNET,
      'orchestrator handoff rejected because workflow progress could still be applied in the same activation',
      expect.objectContaining({
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-implement-1',
        task_id: 'task-orchestrator',
        stage_name: 'implement',
        reason_code: 'orchestrator_close_then_successor_stage_progress_required',
        next_stage_name: 'review',
      }),
    );
  });

  it('rejects a handoff-only endgame when the current work item must close before successor-stage routing', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            id: 'task-orchestrator',
            role: 'orchestrator',
            stage_name: 'verify',
            work_item_id: 'work-item-verify-1',
            is_orchestrator_task: true,
            metadata: { task_kind: 'orchestrator' },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'work-item-verify-1',
              stage_name: 'verify',
              completed_at: null,
              created_at: new Date('2026-04-02T11:17:59Z'),
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'task-qa-1',
              role: 'QA Reviewer',
              state: 'completed',
              work_item_id: 'work-item-verify-1',
              is_orchestrator_task: false,
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            definition: {
              lifecycle: 'planned',
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              stages: [
                { name: 'review', goal: 'Review the fix' },
                { name: 'verify', goal: 'Verify the fix' },
                { name: 'release-approval', goal: 'Record the release decision' },
              ],
            },
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.submitTaskHandoff('tenant-1', 'task-orchestrator', {
        request_id: 'handoff:task-orchestrator:r0:route-release-approval',
        summary: 'Verify findings are complete and release approval is next.',
        completion: 'full',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Focused work can close now and its immediate successor stage can start after closure. Complete the work item, route the successor stage, then submit_handoff.',
      details: {
        reason_code: 'orchestrator_close_then_successor_stage_progress_required',
        recoverable: true,
        recovery_hint: 'complete_work_item_then_route_successor_stage_before_handoff',
        safetynet_behavior_id: ORCHESTRATOR_PROGRESS_GUIDANCE_SAFETYNET.id,
        recovery: {
          status: 'action_required',
          reason: 'orchestrator_close_then_successor_stage_progress_required',
          action: 'complete_work_item_then_route_successor_stage_before_handoff',
          target_type: 'workflow',
          target_id: 'workflow-1',
        },
        closure_context: expect.objectContaining({
          work_item_can_close_now: true,
          workflow_can_close_now: false,
          next_stage_can_start_now: false,
          close_then_successor_stage_can_start_now: true,
          next_stage_name: 'release-approval',
          stage_name: 'verify',
          work_item_id: 'work-item-verify-1',
        }),
      },
    });

    expect(logSafetynetTriggered).toHaveBeenCalledWith(
      ORCHESTRATOR_PROGRESS_GUIDANCE_SAFETYNET,
      'orchestrator handoff rejected because workflow progress could still be applied in the same activation',
      expect.objectContaining({
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-verify-1',
        task_id: 'task-orchestrator',
        stage_name: 'verify',
        reason_code: 'orchestrator_close_then_successor_stage_progress_required',
        next_stage_name: 'release-approval',
        work_item_can_close_now: true,
      }),
    );
  });
});
