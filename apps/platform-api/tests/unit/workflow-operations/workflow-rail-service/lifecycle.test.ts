import { describe, expect, it, vi } from 'vitest';

import { WorkflowRailService } from '../../../../src/services/workflow-operations/workflow-rail-service.js';

describe('WorkflowRailService lifecycle filters', () => {
  it('passes the lifecycle filter through to the live source so planned and ongoing rails can page independently', async () => {
    const liveService = {
      getLive: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-31T00:00:00.000Z',
          latestEventId: 42,
          token: 'mission-control:42',
        },
        sections: [],
        attentionItems: [],
      })),
      countWorkflows: vi.fn(async () => 0),
    };

    const service = new WorkflowRailService(
      liveService as never,
      { getRecent: vi.fn() } as never,
      { getHistory: vi.fn() } as never,
    );

    await service.getRail('tenant-1', {
      mode: 'live',
      lifecycleFilter: 'planned',
      page: 2,
      perPage: 100,
    } as never);

    expect(liveService.getLive).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        page: 2,
        perPage: 100,
        lifecycleFilter: 'planned',
      }),
    );
    expect(liveService.countWorkflows).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        lifecycleFilter: 'planned',
      }),
    );
  });
});
