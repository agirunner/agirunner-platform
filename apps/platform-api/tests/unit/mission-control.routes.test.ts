import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-1',
    };
  },
  withAllowedScopes: () => async () => {},
}));

describe('mission control routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('routes live, recent, history, and workspace requests through the mission-control services', async () => {
    const { missionControlRoutes } = await import('../../src/api/routes/mission-control.routes.js');
    const missionControlLiveService = { getLive: vi.fn(async () => ({ sections: [], attentionItems: [] })) };
    const missionControlRecentService = { getRecent: vi.fn(async () => ({ packets: [] })) };
    const missionControlHistoryService = { getHistory: vi.fn(async () => ({ packets: [] })) };
    const missionControlWorkspaceService = { getWorkspace: vi.fn(async () => ({ workflow: null })) };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('missionControlLiveService', missionControlLiveService as never);
    app.decorate('missionControlRecentService', missionControlRecentService as never);
    app.decorate('missionControlHistoryService', missionControlHistoryService as never);
    app.decorate('missionControlWorkspaceService', missionControlWorkspaceService as never);
    await app.register(missionControlRoutes);

    const headers = { authorization: 'Bearer test' };
    const liveResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/mission-control/live?page=2&per_page=25',
      headers,
    });
    const recentResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/mission-control/recent?limit=15',
      headers,
    });
    const historyResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/mission-control/history?workflow_id=workflow-1&limit=30',
      headers,
    });
    const workspaceResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/mission-control/workflows/workflow-1/workspace?history_limit=11&output_limit=7',
      headers,
    });

    expect(liveResponse.statusCode).toBe(200);
    expect(recentResponse.statusCode).toBe(200);
    expect(historyResponse.statusCode).toBe(200);
    expect(workspaceResponse.statusCode).toBe(200);
    expect(liveResponse.json()).toEqual({ data: { sections: [], attentionItems: [] } });
    expect(recentResponse.json()).toEqual({ data: { packets: [] } });
    expect(historyResponse.json()).toEqual({ data: { packets: [] } });
    expect(workspaceResponse.json()).toEqual({ data: { workflow: null } });

    expect(missionControlLiveService.getLive).toHaveBeenCalledWith('tenant-1', { page: 2, perPage: 25 });
    expect(missionControlRecentService.getRecent).toHaveBeenCalledWith('tenant-1', { limit: 15 });
    expect(missionControlHistoryService.getHistory).toHaveBeenCalledWith('tenant-1', {
      workflowId: 'workflow-1',
      limit: 30,
    });
    expect(missionControlWorkspaceService.getWorkspace).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      historyLimit: 11,
      outputLimit: 7,
    });
  });
});
