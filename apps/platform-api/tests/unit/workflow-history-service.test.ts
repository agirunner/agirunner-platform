import { describe, expect, it, vi } from 'vitest';

import { WorkflowHistoryService } from '../../src/services/workflow-operations/workflow-history-service.js';

describe('WorkflowHistoryService', () => {
  it('groups workflow history items and exposes platform-authored filters', async () => {
    const legacyHistoryService = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:40:00.000Z',
          latestEventId: 110,
          token: 'mission-control:110',
        },
        packets: [
          {
            id: 'event:1',
            category: 'output',
            title: 'Release package moved to approval',
            summary: 'Verification completed and approval is now required.',
            changedAt: '2026-03-27T22:39:00.000Z',
            workflowId: 'workflow-1',
          },
        ],
      })),
    };

    const service = new WorkflowHistoryService(legacyHistoryService as never);
    const result = await service.getHistory('tenant-1', 'workflow-1');

    expect(result.snapshot_version).toBe('workflow-operations:110');
    expect(result.groups).toEqual([
      expect.objectContaining({
        group_id: '2026-03-27',
        item_ids: ['event:1'],
      }),
    ]);
    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'event:1',
        item_kind: 'deliverable',
        headline: 'Release package moved to approval',
      }),
    ]);
    expect(result.filters).toEqual({
      available: ['briefs', 'interventions', 'inputs', 'deliverables', 'redrives'],
      active: [],
    });
  });
});
