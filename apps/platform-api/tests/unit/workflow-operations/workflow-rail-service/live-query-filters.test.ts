import { describe, expect, it, vi } from 'vitest';

import { WorkflowRailService } from '../../../../src/services/workflow-operations/workflow-rail-service.js';

describe('WorkflowRailService live query filters', () => {
  it('forwards search and needs-action filters into the live rail query and count path', async () => {
    const liveService = {
      getLive: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:30:00.000Z',
          latestEventId: 42,
          token: 'mission-control:42',
        },
        sections: [],
        attentionItems: [],
      })),
      countWorkflows: vi.fn(async () => 7),
    };
    const service = new WorkflowRailService(
      liveService as never,
      { getRecent: vi.fn() } as never,
      { getHistory: vi.fn() } as never,
    );

    await service.getRail('tenant-1', {
      mode: 'live',
      page: 3,
      perPage: 25,
      search: 'release',
      needsActionOnly: true,
      lifecycleFilter: 'planned',
    });

    expect(liveService.getLive).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        page: 3,
        perPage: 25,
        lifecycleFilter: 'planned',
        search: 'release',
        needsActionOnly: true,
      }),
    );
    expect(liveService.countWorkflows).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        lifecycleFilter: 'planned',
        search: 'release',
        needsActionOnly: true,
      }),
    );
  });

  it('passes advanced playbook and recency filters through to the live source', async () => {
    const liveService = {
      getLive: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-31T18:30:00.000Z',
          latestEventId: 77,
          token: 'mission-control:77',
        },
        sections: [],
        attentionItems: [],
      })),
      countWorkflows: vi.fn(async () => 0),
      listWorkflowCards: vi.fn(async () => []),
    };
    const service = new WorkflowRailService(
      liveService as never,
      { getRecent: vi.fn() } as never,
      { getHistory: vi.fn() } as never,
    );

    await service.getRail('tenant-1', {
      mode: 'live',
      lifecycleFilter: 'planned',
      playbookId: '00000000-0000-4000-8000-000000000009',
      updatedWithin: '7d',
      search: 'release',
      needsActionOnly: true,
      page: 2,
      perPage: 50,
    });

    expect(liveService.getLive).toHaveBeenCalledWith('tenant-1', {
      page: 2,
      perPage: 50,
      lifecycleFilter: 'planned',
      playbookId: '00000000-0000-4000-8000-000000000009',
      updatedWithin: '7d',
      search: 'release',
      needsActionOnly: true,
    });
    expect(liveService.countWorkflows).toHaveBeenCalledWith('tenant-1', {
      lifecycleFilter: 'planned',
      playbookId: '00000000-0000-4000-8000-000000000009',
      updatedWithin: '7d',
      search: 'release',
      needsActionOnly: true,
    });
  });
});
