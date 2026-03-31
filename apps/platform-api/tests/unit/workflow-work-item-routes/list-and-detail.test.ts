import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkflowWorkItemRoutesApp,
  handoffRouteMocks,
  resetWorkflowWorkItemRouteMocks,
  workflowRoutes,
} from './support.js';

describe('workflow work-item routes', () => {
  let app: ReturnType<typeof createWorkflowWorkItemRoutesApp>['app'] | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    resetWorkflowWorkItemRouteMocks();
    handoffRouteMocks.listWorkItemHandoffs.mockResolvedValue([{ id: 'handoff-1', summary: 'ready' }]);
    handoffRouteMocks.getLatestWorkItemHandoff.mockResolvedValue({ id: 'handoff-1', summary: 'ready' });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('forwards grouped list filters and include-children detail reads', async () => {
    const { app: routeApp, workflowService } = createWorkflowWorkItemRoutesApp({
      workflowService: {
        listWorkflowWorkItems: vi.fn(async () => [{ id: 'wi-parent', children_count: 2, is_milestone: true }]),
        getWorkflowWorkItem: vi.fn(async () => ({
          id: 'wi-parent',
          children_count: 2,
          is_milestone: true,
          children: [{ id: 'wi-child-1' }],
        })),
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/work-items?parent_work_item_id=wi-root&stage_name=implementation&column_id=active&grouped=true',
      headers: { authorization: 'Bearer test' },
    });
    const detailResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/work-items/wi-parent?include_children=true',
      headers: { authorization: 'Bearer test' },
    });
    const handoffListResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/work-items/wi-parent/handoffs',
      headers: { authorization: 'Bearer test' },
    });
    const latestHandoffResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/work-items/wi-parent/handoffs/latest',
      headers: { authorization: 'Bearer test' },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(detailResponse.statusCode).toBe(200);
    expect(handoffListResponse.statusCode).toBe(200);
    expect(latestHandoffResponse.statusCode).toBe(200);
    expect(workflowService.listWorkflowWorkItems).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      parent_work_item_id: 'wi-root',
      stage_name: 'implementation',
      column_id: 'active',
      grouped: true,
    });
    expect(workflowService.getWorkflowWorkItem).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      'wi-parent',
      { include_children: true },
    );
    expect(listResponse.json().data[0]).toEqual(
      expect.objectContaining({ id: 'wi-parent', children_count: 2, is_milestone: true }),
    );
    expect(detailResponse.json().data).toEqual(
      expect.objectContaining({
        id: 'wi-parent',
        children: [expect.objectContaining({ id: 'wi-child-1' })],
      }),
    );
    expect(handoffRouteMocks.listWorkItemHandoffs).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      'wi-parent',
    );
    expect(handoffRouteMocks.getLatestWorkItemHandoff).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      'wi-parent',
    );
  });
});
