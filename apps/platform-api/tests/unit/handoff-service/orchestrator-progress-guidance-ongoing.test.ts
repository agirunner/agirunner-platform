import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HandoffService } from '../../../src/services/handoff-service/handoff-service.js';
import { logSafetynetTriggered } from '../../../src/services/safetynet/logging.js';
import { makeHandoffRow, makeTaskRow } from './handoff-service.fixtures.js';

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: vi.fn(),
}));

describe('HandoffService orchestrator progress guidance for ongoing workflows', () => {
  beforeEach(() => {
    vi.mocked(logSafetynetTriggered).mockReset();
  });

  it('allows an orchestrator handoff when an ongoing workflow has no open work items remaining', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            id: 'task-orchestrator',
            role: 'orchestrator',
            work_item_id: null,
            stage_name: null,
            is_orchestrator_task: true,
            metadata: { task_kind: 'orchestrator' },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'work-item-done-1',
              stage_name: 'implementation',
              completed_at: new Date('2026-04-02T12:00:00Z'),
              created_at: new Date('2026-04-02T11:00:00Z'),
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
              work_item_id: 'work-item-done-1',
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
              lifecycle: 'ongoing',
              board: {
                columns: [
                  { id: 'active', label: 'Active' },
                  { id: 'done', label: 'Done', is_terminal: true },
                ],
              },
              stages: [{ name: 'implementation', goal: 'Deliver the work' }],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 0 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-ongoing-1',
              task_id: 'task-orchestrator',
              work_item_id: null,
              role: 'orchestrator',
              stage_name: null,
              summary: 'Observed that the ongoing workflow is idle after the latest completion.',
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.submitTaskHandoff('tenant-1', 'task-orchestrator', {
        request_id: 'handoff:task-orchestrator:r0:ongoing-idle',
        summary: 'Observed that the ongoing workflow is idle after the latest completion.',
        completion: 'full',
      }),
    ).resolves.toEqual(expect.objectContaining({
      id: 'handoff-ongoing-1',
      role: 'orchestrator',
      summary: 'Observed that the ongoing workflow is idle after the latest completion.',
    }));

    expect(logSafetynetTriggered).not.toHaveBeenCalled();
  });
});
