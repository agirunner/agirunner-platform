import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { workflowRoutes } from '../../src/api/routes/workflows.routes.js';

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
  withScope: () => async () => {},
}));

describe('workflow routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('does not register the removed manual-rework route', async () => {
    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', {});
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('projectService', { getProject: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
    });
    await app.register(workflowRoutes);

    const routes = app.printRoutes();

    expect(routes).not.toContain('/api/v1/workflows/:id/manual-rework');
    expect(routes).toContain('├── tasks (GET, HEAD)');
    expect(routes).toContain('├── events (GET, HEAD)');
  });

  it('exposes workflow-scoped event browsing with workflow entity fallback filtering', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            type: 'workflow.activation_requeued',
            entity_type: 'workflow',
            entity_id: 'workflow-1',
            data: {
              activation_id: 'activation-1',
              stage_name: 'implementation',
            },
          },
        ],
        rowCount: 1,
      });

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', { query });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('projectService', { getProject: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/events?activation_id=activation-1&stage_name=implementation',
    });

    expect(response.statusCode).toBe(200);
    const [countSql, countParams] = query.mock.calls[0];
    const [selectSql, selectParams] = query.mock.calls[1];
    expect(countSql).toContain(
      "(entity_id = $2 OR COALESCE(data->>'workflow_id', CASE WHEN entity_type = 'workflow' THEN entity_id::text ELSE '' END) = $2)",
    );
    expect(countSql).toContain("COALESCE(data->>'activation_id', '') = $");
    expect(countSql).toContain("COALESCE(data->>'stage_name', '') = $");
    expect(countParams.slice(0, 4)).toEqual(['tenant-1', 'workflow-1', 'implementation', 'activation-1']);
    expect(selectSql).toContain('ORDER BY created_at DESC');
    expect(selectParams).toEqual(['tenant-1', 'workflow-1', 'implementation', 'activation-1', 20, 0]);
  });
});
