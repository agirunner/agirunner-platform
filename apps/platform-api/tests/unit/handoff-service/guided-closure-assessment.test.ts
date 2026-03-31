import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../src/errors/domain-errors.js';
import { HandoffService } from '../../../src/services/handoff-service/handoff-service.js';
import { makeHandoffRow, makeTaskRow } from './handoff-service.fixtures.js';

describe('HandoffService guided closure assessment behavior', () => {
  it('allows resolution on assessment task handoffs', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            id: 'task-qa-1',
            work_item_id: 'work-item-verify-1',
            role: 'live-test-qa',
            stage_name: 'verification',
            input: {
              subject_task_id: 'task-dev-1',
              subject_work_item_id: 'work-item-impl-1',
              subject_revision: 1,
            },
            metadata: { task_kind: 'assessment', team_name: 'delivery' },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-qa-1',
              task_id: 'task-qa-1',
              work_item_id: 'work-item-verify-1',
              role: 'live-test-qa',
              stage_name: 'verification',
              request_id: 'req-qa-1',
              summary: 'Request changes: verification found an environment gap.',
              resolution: 'request_changes',
              remaining_items: ['Make the documented test command runnable in the supported environment.'],
              focus_areas: ['Verification command contract'],
              successor_context: 'Check the repository test command before approving.',
              created_at: new Date('2026-03-21T18:22:48Z'),
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-qa-1', {
      request_id: 'req-qa-1',
      summary: 'Request changes: verification found an environment gap.',
      completion: 'full',
      resolution: 'request_changes',
      remaining_items: ['Make the documented test command runnable in the supported environment.'],
      focus_areas: ['Verification command contract'],
      successor_context: 'Check the repository test command before approving.',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-qa-1',
        resolution: 'request_changes',
        stage_name: 'verification',
      }),
    );
    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_handoffs'),
    ) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(insertCall?.[1]?.[22] ?? '{}'))).toEqual(
      expect.objectContaining({
        task_kind: 'assessment',
        subject_task_id: 'task-dev-1',
        subject_work_item_id: 'work-item-impl-1',
        subject_revision: 1,
      }),
    );
  });

  it('requires resolution on successful assessment handoffs', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [makeTaskRow({
          id: 'task-qa-1',
          work_item_id: 'work-item-verify-1',
          role: 'live-test-qa',
          stage_name: 'verification',
          input: { subject_task_id: 'task-dev-1', subject_revision: 1 },
          metadata: { task_kind: 'assessment', team_name: 'delivery' },
        })],
        rowCount: 1,
      }),
    };

    const service = new HandoffService(pool as never);

    await expect(service.submitTaskHandoff('tenant-1', 'task-qa-1', {
      request_id: 'req-qa-1',
      summary: 'Verified the fix and collected evidence.',
      completion: 'full',
    })).rejects.toThrowError(
      new ValidationError('resolution is required on full assessment or approval handoffs'),
    );

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('requires resolution on successful assessment handoffs when the task kind is stored as task_type', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [makeTaskRow({
          id: 'task-qa-1',
          work_item_id: 'work-item-verify-1',
          role: 'live-test-qa',
          stage_name: 'verification',
          input: { subject_task_id: 'task-dev-1', subject_revision: 1 },
          metadata: { task_type: 'assessment', team_name: 'delivery' },
        })],
        rowCount: 1,
      }),
    };

    const service = new HandoffService(pool as never);

    await expect(service.submitTaskHandoff('tenant-1', 'task-qa-1', {
      request_id: 'req-qa-type-1',
      summary: 'Verified the fix and collected evidence.',
      completion: 'full',
    })).rejects.toThrowError(
      new ValidationError('resolution is required on full assessment or approval handoffs'),
    );

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('allows blocked assessment handoffs without resolution', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            id: 'task-qa-1',
            work_item_id: 'work-item-verify-1',
            role: 'live-test-qa',
            stage_name: 'verification',
            input: { subject_task_id: 'task-dev-1', subject_revision: 1 },
            metadata: { task_kind: 'assessment', team_name: 'delivery' },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-qa-1',
              task_id: 'task-qa-1',
              work_item_id: 'work-item-verify-1',
              role: 'live-test-qa',
              stage_name: 'verification',
              request_id: 'req-qa-1',
              summary: 'Blocked by missing test dependency.',
              completion: 'blocked',
              resolution: null,
              blockers: ['Install the missing dependency in the execution image.'],
              successor_context: 'Re-run verification after the dependency is available.',
              created_at: new Date('2026-03-21T18:22:48Z'),
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-qa-1', {
      request_id: 'req-qa-1',
      summary: 'Blocked by missing test dependency.',
      completion: 'blocked',
      blockers: ['Install the missing dependency in the execution image.'],
      successor_context: 'Re-run verification after the dependency is available.',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-qa-1',
        completion: 'blocked',
        resolution: null,
      }),
    );
  });

  it('allows blocked assessment decisions on successful assessment handoffs', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            id: 'task-qa-1',
            work_item_id: 'work-item-verify-1',
            role: 'live-test-qa',
            stage_name: 'verification',
            input: { subject_task_id: 'task-dev-1', subject_revision: 2 },
            metadata: { task_kind: 'assessment', team_name: 'delivery' },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-qa-2',
              task_id: 'task-qa-1',
              work_item_id: 'work-item-verify-1',
              role: 'live-test-qa',
              stage_name: 'verification',
              request_id: 'req-qa-block-1',
              summary: 'The subject is blocked on missing production credentials.',
              completion: 'full',
              resolution: 'blocked',
              created_at: new Date('2026-03-22T12:00:00Z'),
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-qa-1', {
      request_id: 'req-qa-block-1',
      summary: 'The subject is blocked on missing production credentials.',
      completion: 'full',
      resolution: 'blocked' as never,
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-qa-2',
        completion: 'full',
        resolution: 'blocked',
      }),
    );
  });

  it('accepts explicit completion_state and decision_state on assessment handoffs', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            id: 'task-qa-3',
            role: 'policy-reviewer',
            work_item_id: 'work-item-verify-1',
            stage_name: 'verification',
            input: {
              subject_task_id: 'task-dev-1',
              subject_work_item_id: 'work-item-impl-1',
              subject_revision: 3,
            },
            metadata: { task_kind: 'assessment', team_name: 'delivery' },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-qa-3',
              task_id: 'task-qa-3',
              role: 'policy-reviewer',
              work_item_id: 'work-item-verify-1',
              stage_name: 'verification',
              request_id: 'req-qa-3',
              summary: 'Policy blocked the release packet pending legal clarification.',
              completion: 'full',
              completion_state: 'full',
              resolution: 'blocked',
              decision_state: 'blocked',
              blockers: ['Legal clarification is required before release.'],
              role_data: {
                task_kind: 'assessment',
                subject_task_id: 'task-dev-1',
                subject_work_item_id: 'work-item-impl-1',
                subject_revision: 3,
              },
              subject_ref: {
                kind: 'task',
                task_id: 'task-dev-1',
                work_item_id: 'work-item-impl-1',
              },
              subject_revision: 3,
              outcome_action_applied: 'block_subject',
              created_at: new Date('2026-03-23T12:00:00Z'),
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-qa-3', {
      request_id: 'req-qa-3',
      summary: 'Policy blocked the release packet pending legal clarification.',
      completion_state: 'full',
      decision_state: 'blocked',
      outcome_action_applied: 'block_subject',
      blockers: ['Legal clarification is required before release.'],
    } as never);

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-qa-3',
        completion_state: 'full',
        decision_state: 'blocked',
        outcome_action_applied: 'block_subject',
        subject_revision: 3,
        subject_ref: expect.objectContaining({
          kind: 'task',
          task_id: 'task-dev-1',
          work_item_id: 'work-item-impl-1',
        }),
      }),
    );
  });
});
