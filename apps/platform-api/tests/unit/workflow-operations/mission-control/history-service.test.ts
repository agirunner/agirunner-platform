import { describe, expect, it, vi } from 'vitest';

import { MissionControlHistoryService } from '../../../../src/services/workflow-operations/mission-control/history-service.js';

describe('MissionControlHistoryService', () => {
  it('returns workflow-scoped history packets from the event query service', async () => {
    const pool = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => {
        if (String(_sql).includes('FROM events')) {
          expect(params?.[1]).toBe('workflow-1');
          return {
            rows: [
              {
                id: 7,
                type: 'task.retry_requested',
                entity_type: 'task',
                entity_id: 'task-1',
                actor_type: 'user',
                actor_id: 'operator-1',
                data: {
                  workflow_id: 'workflow-1',
                  reason: 'Regression fix requested',
                },
                created_at: '2026-03-27T04:10:00.000Z',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const liveService = {
      getLatestEventId: vi.fn(async () => 9),
      listWorkflowCards: vi.fn(async () => [
        {
          id: 'workflow-1',
          name: 'Release Workflow',
          posture: 'recoverable_needs_steering',
          outputDescriptors: [],
        },
      ]),
    };

    const service = new MissionControlHistoryService(pool as never, liveService as never);
    const response = await service.getHistory('tenant-1', { workflowId: 'workflow-1', limit: 20 });

    expect(response.packets).toEqual([
      expect.objectContaining({
        workflowId: 'workflow-1',
        category: 'intervention',
        summary: 'Reason: Regression fix requested',
        carryover: true,
      }),
    ]);
  });
});
