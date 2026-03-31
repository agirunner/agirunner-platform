import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
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
    const { workflowOperationsRoutes } = await import('../../../../../src/api/routes/workflows/operations.routes.js');
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
    const logStreamService = {
      subscribe: vi.fn(() => () => undefined),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowOperationsRailService', workflowOperationsRailService as never);
    app.decorate('workflowOperationsWorkspaceService', workflowOperationsWorkspaceService as never);
    app.decorate('workflowOperationsStreamService', workflowOperationsStreamService as never);
    app.decorate('eventStreamService', {
      subscribe: vi.fn(() => () => undefined),
    } as never);
    app.decorate('logStreamService', logStreamService as never);
    await app.register(workflowOperationsRoutes);

    const headers = { authorization: 'Bearer test' };
    const liveResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/workflows?mode=live&needs_action_only=true',
      headers,
    });
    const workspaceResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/workflows/workflow-1/workspace?work_item_id=work-item-1&tab_scope=selected_work_item&live_console_after=console-cursor&briefs_after=briefs-cursor&history_after=history-cursor&deliverables_after=deliverables-cursor&live_console_limit=20&briefs_limit=15&history_limit=30&deliverables_limit=8',
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
      lifecycleFilter: 'all',
      playbookId: undefined,
      search: undefined,
      page: 1,
      perPage: 100,
      selectedWorkflowId: undefined,
      updatedWithin: 'all',
    });
    expect(workflowOperationsWorkspaceService.getWorkspace).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      boardMode: undefined,
      boardFilters: undefined,
      workItemId: 'work-item-1',
      taskId: undefined,
      tabScope: 'selected_work_item',
      liveConsoleAfter: 'console-cursor',
      briefsAfter: 'briefs-cursor',
      historyAfter: 'history-cursor',
      deliverablesAfter: 'deliverables-cursor',
      liveConsoleLimit: 20,
      briefsLimit: 15,
      historyLimit: 30,
      deliverablesLimit: 8,
    });
    expect(workflowOperationsStreamService.buildRailBatch).toHaveBeenCalledWith('tenant-1', {
      mode: 'live',
      needsActionOnly: false,
      lifecycleFilter: 'all',
      playbookId: undefined,
      search: undefined,
      afterCursor: 'workflow-operations:41',
      selectedWorkflowId: undefined,
      updatedWithin: 'all',
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

  it('adds CORS headers to workflow stream responses for browser clients', async () => {
    const { workflowOperationsRoutes } = await import('../../../../../src/api/routes/workflows/operations.routes.js');
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
        surface_cursors: {
          live_console_head: null,
          history_head: null,
          deliverables_head: null,
        },
      })),
    };
    const eventStreamService = {
      subscribe: vi.fn(() => () => undefined),
    };
    const logStreamService = {
      subscribe: vi.fn(() => () => undefined),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowOperationsRailService', workflowOperationsRailService as never);
    app.decorate('workflowOperationsWorkspaceService', workflowOperationsWorkspaceService as never);
    app.decorate('workflowOperationsStreamService', workflowOperationsStreamService as never);
    app.decorate('eventStreamService', eventStreamService as never);
    app.decorate('logStreamService', logStreamService as never);
    await app.register(workflowOperationsRoutes);

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve test server address.');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const headers = {
      authorization: 'Bearer test',
      accept: 'text/event-stream',
      origin: 'http://localhost:3000',
    };

    const railController = new AbortController();
    const railResponse = await fetch(`${baseUrl}/api/v1/operations/workflows/stream?mode=live`, {
      headers,
      signal: railController.signal,
    });
    railController.abort();

    const workspaceController = new AbortController();
    const workspaceResponse = await fetch(`${baseUrl}/api/v1/operations/workflows/workflow-1/stream`, {
      headers,
      signal: workspaceController.signal,
    });
    workspaceController.abort();

    expect(railResponse.status).toBe(200);
    expect(workspaceResponse.status).toBe(200);
    expect(railResponse.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(workspaceResponse.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(railResponse.headers.get('access-control-allow-credentials')).toBe('true');
    expect(workspaceResponse.headers.get('access-control-allow-credentials')).toBe('true');
    expect(eventStreamService.subscribe).toHaveBeenCalledWith(
      'tenant-1',
      { workflowId: 'workflow-1' },
      expect.any(Function),
    );
    expect(logStreamService.subscribe).toHaveBeenCalledWith(
      'tenant-1',
      { workflowId: 'workflow-1', category: ['agent_loop', 'task_lifecycle'] },
      expect.any(Function),
    );
  });

  it('keeps workspace streams open when an async refresh batch build rejects', async () => {
    const { workflowOperationsRoutes } = await import('../../../../../src/api/routes/workflows/operations.routes.js');
    const workflowOperationsRailService = {
      getRail: vi.fn(async () => ({ rows: [], selected_workflow_id: null })),
    };
    const workflowOperationsWorkspaceService = {
      getWorkspace: vi.fn(async () => ({ workflow_id: 'workflow-1' })),
    };
    let refreshCallback: (() => void) | undefined;
    const workflowOperationsStreamService = {
      buildRailBatch: vi.fn(async () => ({
        generated_at: '2026-03-29T00:00:00.000Z',
        latest_event_id: 42,
        cursor: 'workflow-operations:42',
        snapshot_version: 'workflow-operations:42',
        events: [],
      })),
      buildWorkspaceBatch: vi
        .fn()
        .mockResolvedValueOnce({
          generated_at: '2026-03-29T00:00:00.000Z',
          latest_event_id: 42,
          cursor: 'workflow-operations:42',
          snapshot_version: 'workflow-operations:42',
          events: [],
          surface_cursors: {
            live_console_head: null,
            briefs_head: null,
            history_head: null,
            deliverables_head: null,
          },
        })
        .mockRejectedValueOnce(new Error('refresh failed')),
    };
    const eventStreamService = {
      subscribe: vi.fn((_tenantId: string, _filters: object, callback: () => void) => {
        refreshCallback = callback;
        return () => undefined;
      }),
    };
    const logStreamService = {
      subscribe: vi.fn(() => () => undefined),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowOperationsRailService', workflowOperationsRailService as never);
    app.decorate('workflowOperationsWorkspaceService', workflowOperationsWorkspaceService as never);
    app.decorate('workflowOperationsStreamService', workflowOperationsStreamService as never);
    app.decorate('eventStreamService', eventStreamService as never);
    app.decorate('logStreamService', logStreamService as never);
    await app.register(workflowOperationsRoutes);

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve test server address.');
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/operations/workflows/workflow-1/stream`, {
      headers: {
        authorization: 'Bearer test',
        accept: 'text/event-stream',
      },
    });

    expect(response.status).toBe(200);
    expect(refreshCallback).toBeTypeOf('function');

    refreshCallback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(workflowOperationsStreamService.buildWorkspaceBatch).toHaveBeenCalledTimes(2);

    response.body?.cancel().catch(() => undefined);
  });

  it('keeps rail streams open when an async refresh batch build rejects', async () => {
    const { workflowOperationsRoutes } = await import('../../../../../src/api/routes/workflows/operations.routes.js');
    const workflowOperationsRailService = {
      getRail: vi.fn(async () => ({ rows: [], selected_workflow_id: null })),
    };
    const workflowOperationsWorkspaceService = {
      getWorkspace: vi.fn(async () => ({ workflow_id: 'workflow-1' })),
    };
    let refreshCallback: (() => void) | undefined;
    const workflowOperationsStreamService = {
      buildRailBatch: vi
        .fn()
        .mockResolvedValueOnce({
          generated_at: '2026-03-29T00:00:00.000Z',
          latest_event_id: 42,
          cursor: 'workflow-operations:42',
          snapshot_version: 'workflow-operations:42',
          events: [],
        })
        .mockRejectedValueOnce(new Error('refresh failed')),
      buildWorkspaceBatch: vi.fn(async () => ({
        generated_at: '2026-03-29T00:00:00.000Z',
        latest_event_id: 42,
        cursor: 'workflow-operations:42',
        snapshot_version: 'workflow-operations:42',
        events: [],
      })),
    };
    const eventStreamService = {
      subscribe: vi.fn((_tenantId: string, _filters: object, callback: () => void) => {
        refreshCallback = callback;
        return () => undefined;
      }),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowOperationsRailService', workflowOperationsRailService as never);
    app.decorate('workflowOperationsWorkspaceService', workflowOperationsWorkspaceService as never);
    app.decorate('workflowOperationsStreamService', workflowOperationsStreamService as never);
    app.decorate('eventStreamService', eventStreamService as never);
    app.decorate('logStreamService', {
      subscribe: vi.fn(() => () => undefined),
    } as never);
    await app.register(workflowOperationsRoutes);

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve test server address.');
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/operations/workflows/stream?mode=live`, {
      headers: {
        authorization: 'Bearer test',
        accept: 'text/event-stream',
      },
    });

    expect(response.status).toBe(200);
    expect(refreshCallback).toBeTypeOf('function');

    refreshCallback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(workflowOperationsStreamService.buildRailBatch).toHaveBeenCalledTimes(2);

    response.body?.cancel().catch(() => undefined);
  });

  it('ignores invalid selected workflow ids on rail list and stream reads instead of forwarding them', async () => {
    const { workflowOperationsRoutes } = await import('../../../../../src/api/routes/workflows/operations.routes.js');
    const workflowOperationsRailService = {
      getRail: vi.fn(async () => ({ rows: [], ongoing_rows: [], selected_workflow_id: null })),
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
    app.decorate('eventStreamService', {
      subscribe: vi.fn(() => () => undefined),
    } as never);
    app.decorate('logStreamService', {
      subscribe: vi.fn(() => () => undefined),
    } as never);
    await app.register(workflowOperationsRoutes);

    const headers = { authorization: 'Bearer test' };
    const liveResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/workflows?mode=live&workflow_id=workflow-not-a-uuid',
      headers,
    });
    const railStreamResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/workflows/stream?mode=live&workflow_id=workflow-not-a-uuid',
      headers,
    });

    expect(liveResponse.statusCode).toBe(200);
    expect(railStreamResponse.statusCode).toBe(200);
    expect(workflowOperationsRailService.getRail).toHaveBeenCalledWith('tenant-1', {
      mode: 'live',
      needsActionOnly: false,
      lifecycleFilter: 'all',
      playbookId: undefined,
      search: undefined,
      page: 1,
      perPage: 100,
      selectedWorkflowId: undefined,
      updatedWithin: 'all',
    });
    expect(workflowOperationsStreamService.buildRailBatch).toHaveBeenCalledWith('tenant-1', {
      mode: 'live',
      needsActionOnly: false,
      lifecycleFilter: 'all',
      playbookId: undefined,
      search: undefined,
      afterCursor: undefined,
      selectedWorkflowId: undefined,
      updatedWithin: 'all',
    });
  });

  it('forwards canonical playbook and recency filters to rail reads and stream batches', async () => {
    const { workflowOperationsRoutes } = await import('../../../../../src/api/routes/workflows/operations.routes.js');
    const workflowOperationsRailService = {
      getRail: vi.fn(async () => ({ rows: [], ongoing_rows: [], selected_workflow_id: null })),
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
    app.decorate('eventStreamService', {
      subscribe: vi.fn(() => () => undefined),
    } as never);
    app.decorate('logStreamService', {
      subscribe: vi.fn(() => () => undefined),
    } as never);
    await app.register(workflowOperationsRoutes);

    const headers = { authorization: 'Bearer test' };
    const playbookId = '00000000-0000-4000-8000-000000000009';
    const liveResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/operations/workflows?mode=live&playbook_id=${playbookId}&updated_within=7d&needs_action_only=true`,
      headers,
    });
    const railStreamResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/operations/workflows/stream?mode=live&playbook_id=${playbookId}&updated_within=7d`,
      headers,
    });

    expect(liveResponse.statusCode).toBe(200);
    expect(railStreamResponse.statusCode).toBe(200);
    expect(workflowOperationsRailService.getRail).toHaveBeenCalledWith('tenant-1', {
      mode: 'live',
      needsActionOnly: true,
      lifecycleFilter: 'all',
      playbookId,
      updatedWithin: '7d',
      search: undefined,
      page: 1,
      perPage: 100,
      selectedWorkflowId: undefined,
    });
    expect(workflowOperationsStreamService.buildRailBatch).toHaveBeenCalledWith('tenant-1', {
      mode: 'live',
      needsActionOnly: false,
      lifecycleFilter: 'all',
      playbookId,
      updatedWithin: '7d',
      search: undefined,
      afterCursor: undefined,
      selectedWorkflowId: undefined,
    });
  });

  it('does not expose legacy mission control route aliases after workflows cutover', async () => {
    const { workflowOperationsRoutes } = await import('../../../../../src/api/routes/workflows/operations.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowOperationsRailService', {
      getRail: vi.fn(async () => ({ rows: [], selected_workflow_id: null })),
    } as never);
    app.decorate('workflowOperationsWorkspaceService', {
      getWorkspace: vi.fn(async () => ({ workflow_id: 'workflow-1' })),
    } as never);
    app.decorate('workflowOperationsStreamService', {
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
    } as never);
    app.decorate('eventStreamService', {
      subscribe: vi.fn(() => () => undefined),
    } as never);
    app.decorate('logStreamService', {
      subscribe: vi.fn(() => () => undefined),
    } as never);
    await app.register(workflowOperationsRoutes);

    const headers = { authorization: 'Bearer test' };
    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/mission-control/live', headers }),
      app.inject({ method: 'GET', url: '/api/v1/mission-control/recent', headers }),
      app.inject({ method: 'GET', url: '/api/v1/mission-control/history', headers }),
      app.inject({
        method: 'GET',
        url: '/api/v1/mission-control/workflows/workflow-1/workspace',
        headers,
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404]);
  });
});
