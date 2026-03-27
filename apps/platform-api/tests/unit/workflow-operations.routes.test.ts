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

describe('workflow operations routes v2', () => {
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

  it('routes canonical reads and stream batch reads through the workflow operations services', async () => {
    const { workflowOperationsRoutes } = await import('../../src/api/routes/workflow-operations.routes.js');
    const workflowOperationsRailService = {
      getRail: vi.fn(async () => ({ rows: [], selected_workflow_id: null })),
    };
    const workflowOperationsWorkspaceService = {
      getWorkspace: vi.fn(async () => ({ workflow_id: 'workflow-1' })),
    };
    const workflowOperationsStreamService = {
      buildRailBatch: vi.fn(async () => ({
        cursor: 'workflow-operations:42',
        snapshot_version: 'workflow-operations:42',
        events: [],
      })),
      buildWorkspaceBatch: vi.fn(async () => ({
        cursor: 'workflow-operations:42',
        snapshot_version: 'workflow-operations:42',
        events: [],
      })),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowOperationsRailService', workflowOperationsRailService as never);
    app.decorate('workflowOperationsWorkspaceService', workflowOperationsWorkspaceService as never);
    app.decorate('workflowOperationsStreamService', workflowOperationsStreamService as never);
    await app.register(workflowOperationsRoutes);

    const headers = { authorization: 'Bearer test' };
    const liveResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/workflows?mode=live&needs_action_only=true',
      headers,
    });
    const workspaceResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/workflows/workflow-1/workspace?work_item_id=work-item-1',
      headers,
    });
    const railStreamResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/workflows/stream?mode=live&after_cursor=workflow-operations:41',
      headers,
    });
    const workspaceStreamResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/workflows/workflow-1/stream?after_cursor=workflow-operations:41',
      headers,
    });

    expect(liveResponse.statusCode).toBe(200);
    expect(workspaceResponse.statusCode).toBe(200);
    expect(railStreamResponse.statusCode).toBe(200);
    expect(workspaceStreamResponse.statusCode).toBe(200);

    expect(workflowOperationsRailService.getRail).toHaveBeenCalledWith('tenant-1', {
      mode: 'live',
      needsActionOnly: true,
      ongoingOnly: false,
      search: undefined,
      page: 1,
      perPage: 100,
      selectedWorkflowId: undefined,
    });
    expect(workflowOperationsWorkspaceService.getWorkspace).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      boardMode: undefined,
      boardFilters: undefined,
      workItemId: 'work-item-1',
      tabScope: 'workflow',
      liveConsoleAfter: undefined,
      historyAfter: undefined,
      deliverablesAfter: undefined,
      historyLimit: 50,
      deliverablesLimit: 10,
    });
    expect(workflowOperationsStreamService.buildRailBatch).toHaveBeenCalledWith('tenant-1', {
      mode: 'live',
      needsActionOnly: false,
      ongoingOnly: false,
      search: undefined,
      afterCursor: 'workflow-operations:41',
      selectedWorkflowId: undefined,
    });
    expect(workflowOperationsStreamService.buildWorkspaceBatch).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      {
        afterCursor: 'workflow-operations:41',
        boardMode: undefined,
        boardFilters: undefined,
        workItemId: undefined,
        tabScope: 'workflow',
      },
    );
  });
});
