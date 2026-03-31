import { describe, expect, it, vi } from 'vitest';

import { WorkflowRailService } from '../../../src/services/workflow-operations/workflow-rail-service.js';

describe('WorkflowRailService recent mode', () => {
  it('builds recent rail rows from recent packets when recent mode is selected', async () => {
    const liveService = { getLive: vi.fn() };
    const recentService = {
      getRecent: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:31:00.000Z',
          latestEventId: 84,
          token: 'mission-control:84',
        },
        packets: [
          {
            workflowId: 'workflow-2',
            workflowName: 'Spec Workflow',
            posture: 'completed',
            summary: 'Final brief published',
            changedAt: '2026-03-27T22:30:00.000Z',
          },
        ],
      })),
    };
    const historyService = { getHistory: vi.fn() };

    const service = new WorkflowRailService(
      liveService as never,
      recentService as never,
      historyService as never,
    );

    const result = await service.getRail('tenant-1', { mode: 'recent' });

    expect(result).toEqual(
      expect.objectContaining({
        snapshot_version: 'workflow-operations:84',
        selected_workflow_id: 'workflow-2',
        rows: [
          expect.objectContaining({
            workflow_id: 'workflow-2',
            name: 'Spec Workflow',
            posture: 'completed',
            live_summary: 'Final brief published',
          }),
        ],
      }),
    );
  });
});
