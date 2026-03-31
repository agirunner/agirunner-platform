import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
  withAllowedScopes: () => async () => {},
}));

describe('workflow work-item lifecycle routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  function createWorkflowReplayPool(workflowId: string) {
    const storedResponses = new Map<string, Record<string, unknown>>();
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          const key = `${String(params?.[2])}:${String(params?.[3])}`;
          expect(params?.[0]).toBe('tenant-1');
          expect(params?.[1]).toBe(workflowId);
          return storedResponses.has(key)
            ? { rowCount: 1, rows: [{ response: storedResponses.get(key) }] }
            : { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          const key = `${String(params?.[2])}:${String(params?.[3])}`;
          const response = params?.[4] as Record<string, unknown>;
          storedResponses.set(key, response);
          return { rowCount: 1, rows: [{ response }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };

    return {
      pool: {
        connect: vi.fn(async () => client),
        query: vi.fn(async (sql: string, params?: unknown[]) => client.query(sql, params)),
      },
      client,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (!app) {
      return;
    }
    await app.close();
    app = undefined;
  });

  it('posts work-item pause/resume/cancel through workflow service with generated request ids', async () => {
    const { workflowRoutes } = await import('../../../../../src/api/routes/workflows/routes.js');
    const pauseWorkflowWorkItem = vi.fn(async () => ({ id: 'wi-1', metadata: { pause_requested_at: '2026-03-30T04:00:00.000Z' } }));
    const resumeWorkflowWorkItem = vi.fn(async () => ({ id: 'wi-1', metadata: {} }));
    const cancelWorkflowWorkItem = vi.fn(async () => ({ id: 'wi-1', metadata: { cancel_requested_at: '2026-03-30T04:05:00.000Z' } }));
    const { pool } = createWorkflowReplayPool('workflow-1');
    const workflowService = {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      getWorkflowBoard: vi.fn(),
      listWorkflowStages: vi.fn(),
      listWorkflowWorkItems: vi.fn(),
      createWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItem: vi.fn(),
      listWorkflowWorkItemTasks: vi.fn(),
      listWorkflowWorkItemEvents: vi.fn(),
      getWorkflowWorkItemMemory: vi.fn(),
      getWorkflowWorkItemMemoryHistory: vi.fn(),
      updateWorkflowWorkItem: vi.fn(),
      resolveWorkflowWorkItemEscalation: vi.fn(),
      pauseWorkflowWorkItem,
      resumeWorkflowWorkItem,
      cancelWorkflowWorkItem,
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
      getResolvedConfig: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('pgPool', pool as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('workspaceService', { getWorkspace: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const pauseResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/pause',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'pause-request-1' },
    });
    const resumeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/resume',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'resume-request-1' },
    });
    const cancelResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/cancel',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'cancel-request-1' },
    });

    expect(pauseResponse.statusCode).toBe(200);
    expect(resumeResponse.statusCode).toBe(200);
    expect(cancelResponse.statusCode).toBe(200);
    expect(pauseWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', keyPrefix: 'prefix' }),
      'workflow-1',
      'wi-1',
    );
    expect(resumeWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', keyPrefix: 'prefix' }),
      'workflow-1',
      'wi-1',
    );
    expect(cancelWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', keyPrefix: 'prefix' }),
      'workflow-1',
      'wi-1',
    );
  });
});
