import { describe, expect, it, vi } from 'vitest';

import { WorkflowLiveConsoleService } from '../../src/services/workflow-operations/workflow-live-console-service.js';

describe('WorkflowLiveConsoleService', () => {
  it('turns workflow history packets into live console items and keeps cursor metadata', async () => {
    const historyService = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:35:00.000Z',
          latestEventId: 101,
          token: 'mission-control:101',
        },
        packets: [
          {
            id: 'event:1',
            category: 'progress',
            title: 'Workflow Activation Started',
            summary: 'Implementation is running validation.',
            changedAt: '2026-03-27T22:34:00.000Z',
            workflowId: 'workflow-1',
          },
          {
            id: 'event:2',
            category: 'output',
            title: 'Milestone Brief',
            summary: 'Release package is ready for approval.',
            changedAt: '2026-03-27T22:35:00.000Z',
            workflowId: 'workflow-1',
          },
        ],
      })),
    };

    const service = new WorkflowLiveConsoleService(historyService as never);
    const result = await service.getLiveConsole('tenant-1', 'workflow-1');

    expect(result).toEqual(
      expect.objectContaining({
        snapshot_version: 'workflow-operations:101',
        items: [
          expect.objectContaining({
            item_id: 'event:1',
            item_kind: 'platform_notice',
            headline: 'Workflow Activation Started',
          }),
          expect.objectContaining({
            item_id: 'event:2',
            item_kind: 'milestone_brief',
            headline: 'Milestone Brief',
          }),
        ],
        next_cursor: null,
      }),
    );
  });
});
