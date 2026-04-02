import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HandoffService } from '../../../src/services/handoff-service/handoff-service.js';
import { makeHandoffRow, makeTaskRow } from './handoff-service.fixtures.js';

const { logSafetynetTriggeredMock } = vi.hoisted(() => ({
  logSafetynetTriggeredMock: vi.fn(),
}));

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: logSafetynetTriggeredMock,
}));

describe('HandoffService submission', () => {
  beforeEach(() => {
    logSafetynetTriggeredMock.mockReset();
  });

  it('submits a structured task handoff with sequenced persistence', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            stage_name: 'implementation',
            metadata: { team_name: 'delivery', output_revision: 2 },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-1',
              request_id: 'req-1',
              stage_name: 'implementation',
              sequence: 3,
              summary: 'Implemented auth flow.',
              changes: [{ file: 'src/auth.ts' }],
              focus_areas: ['error handling'],
              successor_context: 'Focus on refresh token expiry.',
              created_at: new Date('2026-03-15T12:00:00Z'),
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

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-1',
        role: 'developer',
        sequence: 3,
        focus_areas: ['error handling'],
      }),
    );
    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_handoffs'),
    ) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(insertCall?.[1]?.[22] ?? '{}'))).toEqual(
      expect.objectContaining({
        task_kind: 'delivery',
        subject_task_id: 'task-1',
        subject_work_item_id: 'work-item-1',
        subject_revision: 2,
      }),
    );
    expect(logSafetynetTriggeredMock).not.toHaveBeenCalled();
  });

  it('promotes delivery handoffs into canonical work-item deliverables after persistence', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            stage_name: 'implementation',
            metadata: { team_name: 'delivery', output_revision: 2 },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-1',
              request_id: 'req-1',
              stage_name: 'implementation',
              sequence: 3,
              summary: 'Implemented auth flow.',
              changes: [{ file: 'src/auth.ts' }],
              focus_areas: ['error handling'],
              successor_context: 'Focus on refresh token expiry.',
              role_data: { task_kind: 'delivery' },
              created_at: new Date('2026-03-15T12:00:00Z'),
            }),
          }],
          rowCount: 1,
        }),
    };
    const promotionService = {
      promoteFromHandoff: vi.fn(async () => null),
    };

    const service = new HandoffService(
      pool as never,
      undefined,
      undefined,
      undefined,
      promotionService as never,
    );

    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Implemented auth flow.',
      completion: 'full',
      changes: [{ file: 'src/auth.ts' }],
      focus_areas: ['error handling'],
      successor_context: 'Focus on refresh token expiry.',
    });

    expect(promotionService.promoteFromHandoff).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'handoff-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        role_data: expect.objectContaining({
          task_kind: 'delivery',
        }),
      }),
    );
  });

  it('persists guided closure handoff fields without disturbing delivery linkage', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            role: 'reviewer',
            stage_name: 'review',
            metadata: { team_name: 'review', task_kind: 'approval' },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-closure-1',
              task_id: 'task-1',
              request_id: 'req-guided-1',
              role: 'reviewer',
              stage_name: 'review',
              sequence: 1,
              summary: 'Request changes with explicit closure guidance.',
              resolution: 'request_changes',
              decision_state: 'request_changes',
              recommended_next_actions: [{ action_code: 'continue_work' }],
              waived_steps: [{ code: 'secondary_review', reason: 'Primary review was decisive.' }],
              completion_callouts: { completion_notes: 'Closure still possible.' },
              role_data: { task_kind: 'approval', closure_effect: 'advisory' },
              created_at: new Date('2026-03-25T01:00:00Z'),
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-guided-1',
      summary: 'Request changes with explicit closure guidance.',
      completion: 'full',
      resolution: 'request_changes',
      closure_effect: 'advisory',
      recommended_next_actions: [{
        action_code: 'continue_work',
        target_type: 'work_item',
        target_id: 'work-item-1',
        why: 'Rework can proceed immediately.',
        requires_orchestrator_judgment: false,
      }],
      waived_steps: [{
        code: 'secondary_review',
        reason: 'Primary review already found the decisive issue.',
      }],
      completion_callouts: {
        completion_notes: 'Closure still possible.',
      },
    });

    expect(result).toEqual(expect.objectContaining({
      id: 'handoff-closure-1',
      closure_effect: 'advisory',
      recommended_next_actions: [{ action_code: 'continue_work' }],
      completion_callouts: expect.objectContaining({
        completion_notes: 'Closure still possible.',
      }),
    }));
    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_handoffs'),
    ) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(insertCall?.[1]?.[28] ?? '[]'))).toEqual([
      expect.objectContaining({
        action_code: 'continue_work',
        target_id: 'work-item-1',
      }),
    ]);
    expect(JSON.parse(String(insertCall?.[1]?.[29] ?? '[]'))).toEqual([
      expect.objectContaining({
        code: 'secondary_review',
      }),
    ]);
    expect(JSON.parse(String(insertCall?.[1]?.[30] ?? '{}'))).toEqual(
      expect.objectContaining({
        completion_notes: 'Closure still possible.',
        waived_steps: [
          expect.objectContaining({
            code: 'secondary_review',
          }),
        ],
      }),
    );
    expect(logSafetynetTriggeredMock).not.toHaveBeenCalled();
  });

  it('drops invented assessment subject handoff ids from role_data', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            role: 'reviewer',
            stage_name: 'review',
            input: {
              subject_task_id: 'subject-task-1',
              subject_revision: 2,
            },
            metadata: { team_name: 'review', task_kind: 'approval' },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-assessment-1',
              task_id: 'task-1',
              request_id: 'req-assessment-1',
              role: 'reviewer',
              stage_name: 'review',
              sequence: 1,
              summary: 'Approved the reviewed subject.',
              resolution: 'approved',
              decision_state: 'approved',
              role_data: {
                task_kind: 'approval',
                subject_task_id: 'subject-task-1',
                subject_revision: 2,
              },
              created_at: new Date('2026-03-25T01:00:00Z'),
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-assessment-1',
      summary: 'Approved the reviewed subject.',
      completion: 'full',
      resolution: 'approved',
      role_data: {
        subject_handoff_id: 'invented-handoff-id',
      },
    });

    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_handoffs'),
    ) as [string, unknown[]] | undefined;
    const roleData = JSON.parse(String(insertCall?.[1]?.[22] ?? '{}'));
    expect(roleData).toEqual(expect.objectContaining({
      task_kind: 'approval',
      subject_task_id: 'subject-task-1',
      subject_revision: 2,
    }));
    expect(roleData).not.toHaveProperty('subject_handoff_id');
    expect(logSafetynetTriggeredMock).not.toHaveBeenCalled();
  });

  it('derives delivery subject revision from rework count when metadata output revision is stale', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            rework_count: 1,
            metadata: { team_name: 'delivery', output_revision: 1 },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-2',
              task_rework_count: 1,
              request_id: 'req-2',
              summary: 'Implemented the rework.',
              created_at: new Date('2026-03-22T07:00:00Z'),
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-2',
      summary: 'Implemented the rework.',
      completion: 'full',
    });

    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_handoffs'),
    ) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(insertCall?.[1]?.[22] ?? '{}'))).toEqual(
      expect.objectContaining({
        task_kind: 'delivery',
        subject_task_id: 'task-1',
        subject_work_item_id: 'work-item-1',
        subject_revision: 2,
      }),
    );
  });

  it('uses the retried delivery task input subject revision when it is newer than stale metadata', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            rework_count: 1,
            input: { subject_revision: 3 },
            metadata: { team_name: 'delivery', output_revision: 2 },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-3',
              task_rework_count: 1,
              request_id: 'req-3',
              summary: 'Implemented the revision 3 rework.',
              created_at: new Date('2026-03-23T12:00:00Z'),
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-3',
      summary: 'Implemented the revision 3 rework.',
      completion: 'full',
    });

    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_handoffs'),
    ) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(insertCall?.[1]?.[22] ?? '{}'))).toEqual(
      expect.objectContaining({
        task_kind: 'delivery',
        subject_task_id: 'task-1',
        subject_work_item_id: 'work-item-1',
        subject_revision: 3,
      }),
    );
  });

  it('serializes jsonb handoff fields before inserting them', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [makeTaskRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{
          ...makeHandoffRow({
            id: 'handoff-1',
            request_id: 'req-2',
            summary: 'Captured implementation handoff.',
            changes: ['requirements summary'],
            decisions: [{ owner: 'developer' }],
            remaining_items: ['review findings'],
            blockers: ['Need human scope confirmation'],
            focus_areas: ['edge cases'],
            known_risks: ['late requirement drift'],
            successor_context: 'Keep the release scope minimal.',
            role_data: { branch: 'feature/hello-world' },
            created_at: new Date('2026-03-15T12:00:00Z'),
          }),
        }],
        rowCount: 1,
      });

    const service = new HandoffService({ query } as never);

    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-2',
      summary: 'Captured implementation handoff.',
      completion: 'full',
      changes: ['requirements summary'],
      decisions: [{ owner: 'developer' }],
      remaining_items: ['review findings'],
      blockers: ['Need human scope confirmation'],
      focus_areas: ['edge cases'],
      known_risks: ['late requirement drift'],
      successor_context: 'Keep the release scope minimal.',
      role_data: { branch: 'feature/hello-world' },
    });

    const insertParams = query.mock.calls[4][1] as unknown[];
    expect(insertParams[4]).toBe(0);
    expect(insertParams[15]).toBe(JSON.stringify(['requirements summary']));
    expect(insertParams[16]).toBe(JSON.stringify([{ owner: 'developer' }]));
    expect(insertParams[17]).toBe(JSON.stringify(['review findings']));
    expect(insertParams[18]).toBe(JSON.stringify(['Need human scope confirmation']));
    expect(insertParams[22]).toBe(
      JSON.stringify({
        branch: 'feature/hello-world',
        task_kind: 'delivery',
        subject_task_id: 'task-1',
        subject_work_item_id: 'work-item-1',
        subject_revision: 1,
      }),
    );
  });

  it('updates the existing handoff for the same active assessment task attempt when the payload changes', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [makeTaskRow({
        role: 'security-review',
        metadata: { team_name: 'delivery', task_kind: 'assessment' },
      })], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{
          ...makeHandoffRow({
            id: 'handoff-1',
            role: 'security-review',
            summary: 'Interim review note.',
            resolution: 'request_changes',
            remaining_items: ['confirm tests'],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }),
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          ...makeHandoffRow({
            id: 'handoff-1',
            request_id: 'req-2',
            role: 'security-review',
            summary: 'Approved after verification.',
            resolution: 'approved',
            changes: ['Ran Hello World command.'],
            decisions: ['APPROVED'],
            focus_areas: ['handoff to qa'],
            successor_context: 'QA should confirm tests and release posture.',
            role_data: { verdict: 'APPROVED' },
            created_at: new Date('2026-03-15T12:00:00Z'),
          }),
        }],
        rowCount: 1,
      });

    const service = new HandoffService({ query } as never);

    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-2',
      summary: 'Approved after verification.',
      completion: 'full',
      resolution: 'approved',
      changes: ['Ran Hello World command.'],
      decisions: ['APPROVED'],
      focus_areas: ['handoff to qa'],
      successor_context: 'QA should confirm tests and release posture.',
      role_data: { verdict: 'APPROVED' },
    });

    expect(result).toEqual(
      expect.objectContaining({ id: 'handoff-1', request_id: 'req-2', completion: 'full' }),
    );
    expect(query.mock.calls[3]?.[0]).toContain('UPDATE task_handoffs');
  });
});
