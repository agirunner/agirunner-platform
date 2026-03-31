import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../src/errors/error-handler.js';

vi.mock('../../../../src/auth/fastify-auth-hook.js', () => ({
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

describe('workflow operations routes', () => {
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

  it('routes canonical workflow operations reads through the workflow operations services', async () => {
    const { workflowOperationsRoutes } = await import('../../../../src/api/routes/workflows/operations.routes.js');
    const workflowOperationsLiveService = { getLive: vi.fn(async () => ({ sections: [], attentionItems: [] })) };
    const workflowOperationsRecentService = { getRecent: vi.fn(async () => ({ packets: [] })) };
    const workflowOperationsHistoryService = { getHistory: vi.fn(async () => ({ packets: [] })) };
    const workflowOperationsWorkspaceService = { getWorkspace: vi.fn(async () => ({ workflow: null })) };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowOperationsLiveService', workflowOperationsLiveService as never);
    app.decorate('workflowOperationsRecentService', workflowOperationsRecentService as never);
    app.decorate('workflowOperationsHistoryService', workflowOperationsHistoryService as never);
    app.decorate('workflowOperationsWorkspaceService', workflowOperationsWorkspaceService as never);
    await app.register(workflowOperationsRoutes);

    const headers = { authorization: 'Bearer test' };
    const liveResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/workflows?mode=live&page=2&per_page=25',
      headers,
    });
    const recentResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/workflows?mode=recent&limit=15',
      headers,
    });
    const historyResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/workflows?mode=history&workflow_id=workflow-1&limit=30',
      headers,
    });
    const workspaceResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/workflows/workflow-1/workspace?history_limit=11&output_limit=7',
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

    expect(workflowOperationsLiveService.getLive).toHaveBeenCalledWith('tenant-1', { page: 2, perPage: 25 });
    expect(workflowOperationsRecentService.getRecent).toHaveBeenCalledWith('tenant-1', { limit: 15 });
    expect(workflowOperationsHistoryService.getHistory).toHaveBeenCalledWith('tenant-1', {
      workflowId: 'workflow-1',
      limit: 30,
    });
    expect(workflowOperationsWorkspaceService.getWorkspace).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      expect.objectContaining({
        historyLimit: 11,
        deliverablesLimit: 7,
        tabScope: 'workflow',
      }),
    );
  });
});
