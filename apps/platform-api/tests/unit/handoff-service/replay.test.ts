import { describe, expect, it, vi } from 'vitest';

import { ConflictError } from '../../../src/errors/domain-errors.js';
import { HandoffService } from '../../../src/services/handoff-service.js';
import { makeHandoffRow, makeTaskRow } from './handoff-service.fixtures.js';

describe('HandoffService replay handling', () => {
  it('returns the existing handoff for an idempotent request replay', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow()],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-1',
              request_id: 'req-1',
              changes: [{ file: 'src/auth.ts' }],
              focus_areas: ['error handling'],
              successor_context: 'Focus on refresh token expiry.',
              role_data: {
                task_kind: 'delivery',
                subject_task_id: 'task-1',
                subject_work_item_id: 'work-item-1',
                subject_revision: 1,
              },
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Implemented auth flow.',
      completion: 'full',
      changes: [{ file: 'src/auth.ts' }],
      focus_areas: ['error handling'],
      successor_context: 'Focus on refresh token expiry.',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'handoff-1', request_id: 'req-1' }));
  });

  it('returns the persisted handoff when a completed task replays the same request_id with stale payload', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({ state: 'completed' })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-1',
              request_id: 'req-1',
              changes: [{ file: 'src/auth.ts' }],
              focus_areas: ['error handling'],
              successor_context: 'Focus on refresh token expiry.',
              role_data: {
                task_kind: 'delivery',
                subject_task_id: 'task-1',
                subject_work_item_id: 'work-item-1',
                subject_revision: 1,
              },
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Different summary',
      completion: 'full',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'handoff-1', request_id: 'req-1' }));
  });

  it('returns the persisted handoff when a non-editable task attempt already satisfies the handoff contract', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            state: 'output_pending_assessment',
            rework_count: 2,
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-2',
              task_rework_count: 2,
              request_id: 'req-current',
              focus_areas: ['handoff'],
              successor_context: 'Use the stored handoff.',
              role_data: {
                task_kind: 'delivery',
                subject_task_id: 'task-1',
                subject_work_item_id: 'work-item-1',
                subject_revision: 3,
              },
              created_at: new Date('2026-03-16T12:00:00Z'),
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-stale-retry',
      task_rework_count: 2,
      summary: 'New stale payload after the attempt already settled.',
      completion: 'full',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'handoff-2', request_id: 'req-current' }));
  });

  it('reuses the current task-attempt handoff when a stale request_id points at an earlier attempt', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            state: 'output_pending_assessment',
            rework_count: 3,
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-r2',
              task_rework_count: 2,
              request_id: 'req-r2',
              focus_areas: ['delivery'],
              successor_context: 'Review revision 2.',
              role_data: {
                task_kind: 'delivery',
                subject_task_id: 'task-1',
                subject_work_item_id: 'work-item-1',
                subject_revision: 3,
              },
            }),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-r3',
              task_rework_count: 3,
              request_id: 'req-r3',
              focus_areas: ['delivery'],
              successor_context: 'Review revision 3.',
              role_data: {
                task_kind: 'delivery',
                subject_task_id: 'task-1',
                subject_work_item_id: 'work-item-1',
                subject_revision: 4,
              },
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-r2',
      task_rework_count: 3,
      summary: 'Stale retry after revision 3 already persisted.',
      completion: 'full',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'handoff-r3', request_id: 'req-r3' }));
  });

  it('reuses the current task-attempt handoff for an active task when a stale request_id points at an earlier attempt', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({ rework_count: 3 })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-r2',
              task_rework_count: 2,
              request_id: 'req-r2',
              focus_areas: ['delivery'],
              successor_context: 'Review revision 2.',
              role_data: {
                task_kind: 'delivery',
                subject_task_id: 'task-1',
                subject_work_item_id: 'work-item-1',
                subject_revision: 3,
              },
            }),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-r3',
              task_rework_count: 3,
              request_id: 'req-r3',
              focus_areas: ['delivery'],
              successor_context: 'Review revision 3.',
              role_data: {
                task_kind: 'delivery',
                subject_task_id: 'task-1',
                subject_work_item_id: 'work-item-1',
                subject_revision: 4,
              },
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-r2',
      task_rework_count: 3,
      summary: 'Stale retry after revision 3 already persisted while the task stayed active.',
      completion: 'full',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'handoff-r3', request_id: 'req-r3' }));
  });

  it('returns structured recovery guidance when an active task reuses a request_id with a different handoff payload', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow()],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-1',
              request_id: 'req-1',
              changes: [{ file: 'src/auth.ts' }],
              focus_areas: ['error handling'],
              successor_context: 'Focus on refresh token expiry.',
              role_data: {
                task_kind: 'delivery',
                subject_task_id: 'task-1',
                subject_work_item_id: 'work-item-1',
                subject_revision: 1,
              },
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    const error = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Different summary',
      completion: 'full',
    }).then(() => null).catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error?.message).toBe(
      'submit_handoff replay conflicted with the persisted handoff for this task attempt',
    );
    expect(error?.details).toMatchObject({
      reason_code: 'submit_handoff_replay_conflict',
      recovery_hint: 'inspect_persisted_handoff_or_use_new_request_id',
      recoverable: true,
      conflict_source: 'same_request_id_different_payload',
      task_contract_satisfied_by_persisted_handoff: false,
      conflicting_request_ids: {
        submitted_request_id: 'req-1',
        persisted_request_id: 'req-1',
      },
      existing_handoff: {
        id: 'handoff-1',
        request_id: 'req-1',
        task_id: 'task-1',
        task_rework_count: 0,
      },
    });
    expect(error?.details?.replay_conflict_fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'summary',
        operator_message: expect.stringContaining('Persisted handoff summary'),
      }),
    ]));
    expect(error?.details?.escalation_guidance).toMatchObject({
      context_summary: expect.stringContaining('submit_handoff request_id "req-1"'),
      work_so_far: expect.stringContaining('Different summary'),
    });
    expect(error?.details?.suggested_next_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action_code: 'inspect_persisted_handoff',
        target_type: 'handoff',
        target_id: 'handoff-1',
      }),
      expect.objectContaining({
        action_code: 'resubmit_handoff_with_new_request_id',
        target_type: 'task',
        target_id: 'task-1',
      }),
    ]));
  });

  it('rejects stale handoff submissions from an older task rework attempt', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [makeTaskRow({
          rework_count: 2,
          input: {},
          metadata: { team_name: 'delivery', output_revision: 3 },
        })],
        rowCount: 1,
      }),
    };

    const service = new HandoffService(pool as never);

    await expect(service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-stale-1',
      task_rework_count: 1,
      summary: 'Late handoff from the stale attempt.',
      completion: 'full',
    })).rejects.toThrowError(
      new ConflictError('task handoff submission does not match the current task rework attempt'),
    );

    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
