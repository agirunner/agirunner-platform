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
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          id: 101,
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
      url: '/api/v1/workflows/workflow-1/events?activation_id=activation-1&stage_name=implementation&types=workflow.activation_requeued&after=120&limit=5',
    });

    expect(response.statusCode).toBe(200);
    const [selectSql, selectParams] = query.mock.calls[0];
    expect(selectSql).toContain(
      "(entity_id = $2 OR COALESCE(data->>'workflow_id', CASE WHEN entity_type = 'workflow' THEN entity_id::text ELSE '' END) = $2)",
    );
    expect(selectSql).toContain("COALESCE(data->>'activation_id', '') = $");
    expect(selectSql).toContain("COALESCE(data->>'stage_name', '') = $");
    expect(selectSql).toContain('type = ANY(');
    expect(selectSql).toContain('id < $');
    expect(selectSql).toContain('ORDER BY id DESC');
    expect(selectParams).toEqual([
      'tenant-1',
      'workflow-1',
      'implementation',
      'activation-1',
      ['workflow.activation_requeued'],
      120,
      6,
    ]);
    expect(response.json()).toEqual({
      data: [
        {
          id: 101,
          type: 'workflow.activation_requeued',
          entity_type: 'workflow',
          entity_id: 'workflow-1',
          data: {
            activation_id: 'activation-1',
            stage_name: 'implementation',
          },
        },
      ],
      meta: {
        has_more: false,
        next_after: null,
      },
    });
  });

  it('redacts secret-bearing workflow event data in workflow-scoped browsing responses', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          type: 'workflow.activation_requeued',
          entity_type: 'workflow',
          entity_id: 'workflow-1',
          data: {
            workflow_id: 'workflow-1',
            activation_id: 'activation-1',
            api_key: 'sk-secret-value',
            credentials: {
              refresh_token: 'secret:oauth-refresh',
            },
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
      url: '/api/v1/workflows/workflow-1/events',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [
        {
          id: 1,
          type: 'workflow.activation_requeued',
          entity_type: 'workflow',
          entity_id: 'workflow-1',
          data: {
            workflow_id: 'workflow-1',
            activation_id: 'activation-1',
            api_key: 'redacted://event-secret',
            credentials: {
              refresh_token: 'redacted://event-secret',
            },
          },
        },
      ],
      meta: {
        has_more: false,
        next_after: null,
      },
    });
  });

  it('exposes workflow budget reads on the public workflow API', async () => {
    const getWorkflowBudget = vi.fn().mockResolvedValue({
      tokens_used: 1200,
      tokens_limit: 5000,
      cost_usd: 1.25,
      cost_limit_usd: 10,
      elapsed_minutes: 15,
      duration_limit_minutes: 60,
      task_count: 3,
      orchestrator_activations: 2,
      tokens_remaining: 3800,
      cost_remaining_usd: 8.75,
      time_remaining_minutes: 45,
      warning_dimensions: [],
      exceeded_dimensions: [],
      warning_threshold_ratio: 0.8,
    });

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget,
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
    app.decorate('pgPool', { query: vi.fn() });
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
      url: '/api/v1/workflows/workflow-1/budget',
    });

    expect(response.statusCode).toBe(200);
    expect(getWorkflowBudget).toHaveBeenCalledWith('tenant-1', 'workflow-1');
    expect(response.json().data).toEqual(
      expect.objectContaining({
        tokens_used: 1200,
        cost_usd: 1.25,
        warning_threshold_ratio: 0.8,
      }),
    );
  });
});
