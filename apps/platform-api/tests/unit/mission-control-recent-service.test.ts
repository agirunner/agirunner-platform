import { describe, expect, it, vi } from 'vitest';

import { MissionControlRecentService } from '../../src/services/mission-control/mission-control-recent-service.js';

describe('MissionControlRecentService', () => {
  it('turns recent tenant events into review packets with workflow carryover state', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: 12,
            type: 'stage.gate.approve',
            entity_type: 'workflow',
            entity_id: 'workflow-1',
            actor_type: 'user',
            actor_id: 'operator-1',
            data: {
              workflow_id: 'workflow-1',
              summary: 'Release gate approved',
            },
            created_at: '2026-03-27T04:05:00.000Z',
          },
        ],
        rowCount: 1,
      })),
    };
    const liveService = {
      getLatestEventId: vi.fn(async () => 21),
      listWorkflowCards: vi.fn(async () => [
        {
          id: 'workflow-1',
          name: 'Release Workflow',
          posture: 'needs_decision',
          outputDescriptors: [],
        },
      ]),
    };

    const service = new MissionControlRecentService(pool as never, liveService as never);
    const response = await service.getRecent('tenant-1', { limit: 10 });

    expect(liveService.listWorkflowCards).toHaveBeenCalledWith('tenant-1', {
      workflowIds: ['workflow-1'],
    });
    expect(response.version.latestEventId).toBe(21);
    expect(response.packets).toEqual([
      expect.objectContaining({
        workflowId: 'workflow-1',
        workflowName: 'Release Workflow',
        category: 'decision',
        summary: 'Release gate approved',
        carryover: true,
      }),
    ]);
  });
});
