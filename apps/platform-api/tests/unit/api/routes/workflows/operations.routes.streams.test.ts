import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkflowOperationsRoutesApp } from './operations.routes.test-support.js';

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

describe('workflow operations route streams', () => {
  let app: ReturnType<typeof createWorkflowOperationsRoutesApp> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('adds CORS headers to workflow stream responses for browser clients', async () => {
    const { workflowOperationsRoutes } = await import('../../../../../src/api/routes/workflows/operations.routes.js');
    const eventStreamService = {
      subscribe: vi.fn(() => () => undefined),
    };
    const logStreamService = {
      subscribe: vi.fn(() => () => undefined),
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

    app = createWorkflowOperationsRoutesApp({
      workflowOperationsStreamService,
      eventStreamService,
      logStreamService,
    });
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

    app = createWorkflowOperationsRoutesApp({
      workflowOperationsStreamService,
      eventStreamService,
    });
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

    app = createWorkflowOperationsRoutesApp({
      workflowOperationsStreamService,
      eventStreamService,
    });
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
});
