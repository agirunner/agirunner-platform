import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkflowDocument,
  deleteWorkflowDocument,
  updateWorkflowDocument,
} from '../../src/services/document-reference-service.js';
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

vi.mock('../../src/services/document-reference-service.js', () => ({
  createWorkflowDocument: vi.fn(),
  deleteWorkflowDocument: vi.fn(),
  listWorkflowDocuments: vi.fn(async () => []),
  updateWorkflowDocument: vi.fn(),
}));

function createWorkflowControlReplayPool(
  workflowId: string,
  toolName: string,
) {
  let storedResponse: Record<string, unknown> | null = null;
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
        expect(params).toEqual(['tenant-1', workflowId, toolName, 'request-1']);
        return storedResponse
          ? { rowCount: 1, rows: [{ response: storedResponse }] }
          : { rowCount: 0, rows: [] };
      }
      throw new Error(`unexpected client query: ${sql}`);
    }),
    release: vi.fn(),
  };

  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO workflow_tool_results')) {
        storedResponse = params?.[4] as Record<string, unknown>;
        return { rowCount: 1, rows: [{ response: storedResponse }] };
      }
      throw new Error(`unexpected pool query: ${sql}`);
    }),
  };

  return { pool, client };
}

function createTransactionalWorkflowReplayPool(
  workflowId: string,
  toolName: string,
) {
  let storedResponse: Record<string, unknown> | null = null;
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
        expect(params).toEqual(['tenant-1', workflowId, toolName, 'request-1']);
        return storedResponse
          ? { rowCount: 1, rows: [{ response: storedResponse }] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO workflow_tool_results')) {
        storedResponse = params?.[4] as Record<string, unknown>;
        return { rowCount: 1, rows: [{ response: storedResponse }] };
      }
      throw new Error(`unexpected client query: ${sql}`);
    }),
    release: vi.fn(),
  };

  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async () => {
      throw new Error('unexpected pool query');
    }),
  };

  return { pool, client };
}

describe('workflow routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    vi.clearAllMocks();
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

  it('deduplicates explicit workflow chaining by request_id without duplicating parent linkage', async () => {
    const playbookId = '00000000-0000-4000-8000-000000000002';
    const createWorkflow = vi.fn().mockResolvedValue({
      id: 'workflow-child-1',
      playbook_id: playbookId,
      name: 'Follow-up Flow',
      metadata: {
        parent_workflow_id: 'workflow-1',
        chain_origin: 'explicit',
        create_request_id: 'chain-1',
      },
    });
    const getWorkflow = vi.fn(async (_tenantId: string, workflowId: string) => {
      if (workflowId === 'workflow-child-1') {
        return {
          id: 'workflow-child-1',
          playbook_id: playbookId,
          name: 'Follow-up Flow',
          metadata: {
            parent_workflow_id: 'workflow-1',
            chain_origin: 'explicit',
            create_request_id: 'chain-1',
          },
        };
      }
      return {};
    });
    let sourceMetadata: Record<string, unknown> = {};
    let existingReplayVisible = false;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT * FROM workflows WHERE tenant_id = $1 AND id = $2')) {
        expect(params).toEqual(['tenant-1', 'workflow-1']);
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            name: 'Source Flow',
            project_id: 'project-1',
            state: 'active',
            metadata: sourceMetadata,
          }],
        };
      }
      if (sql.includes("metadata->>'parent_workflow_id' = $2") && sql.includes("metadata->>'create_request_id' = $3")) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'chain-1']);
        return existingReplayVisible
          ? { rowCount: 1, rows: [{ id: 'workflow-child-1' }] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes('UPDATE workflows') && sql.includes('metadata = metadata || $3::jsonb')) {
        sourceMetadata = params?.[2] as Record<string, unknown>;
        existingReplayVisible = true;
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow,
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow,
      getWorkflowBudget: async () => ({}),
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

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/chain',
      payload: {
        request_id: 'chain-1',
        playbook_id: playbookId,
        name: 'Follow-up Flow',
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/chain',
      payload: {
        request_id: 'chain-1',
        playbook_id: playbookId,
        name: 'Follow-up Flow',
      },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(createWorkflow).toHaveBeenCalledTimes(1);
    expect(createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        playbook_id: playbookId,
        project_id: 'project-1',
        name: 'Follow-up Flow',
        metadata: expect.objectContaining({
          parent_workflow_id: 'workflow-1',
          chain_origin: 'explicit',
          create_request_id: 'chain-1',
        }),
      }),
    );
    expect(getWorkflow).toHaveBeenCalledWith('tenant-1', 'workflow-child-1');
    expect(first.json().data).toEqual(expect.objectContaining({ id: 'workflow-child-1' }));
    expect(second.json().data).toEqual(expect.objectContaining({ id: 'workflow-child-1' }));
    expect(sourceMetadata.child_workflow_ids).toEqual(['workflow-child-1']);
    expect(sourceMetadata.latest_child_workflow_id).toBe('workflow-child-1');
  });

  it('deduplicates repeated workflow cancel requests by request_id at the route boundary', async () => {
    const { pool } = createWorkflowControlReplayPool('workflow-1', 'operator_cancel_workflow');
    const cancelWorkflow = vi.fn().mockResolvedValue({
      id: 'workflow-1',
      state: 'paused',
      metadata: { cancel_requested_at: '2026-03-12T00:00:00.000Z' },
    });

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
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
      cancelWorkflow,
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', pool);
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

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/cancel',
      payload: { request_id: 'request-1' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/cancel',
      payload: { request_id: 'request-1' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(cancelWorkflow).toHaveBeenCalledTimes(1);
    expect(second.json().data).toEqual(first.json().data);
  });

  it('deduplicates repeated workflow pause requests by request_id at the route boundary', async () => {
    const { pool } = createWorkflowControlReplayPool('workflow-1', 'operator_pause_workflow');
    const pauseWorkflow = vi.fn().mockResolvedValue({
      id: 'workflow-1',
      state: 'paused',
      metadata: { pause_requested_at: '2026-03-12T00:00:00.000Z' },
    });

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
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
      pauseWorkflow,
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', pool);
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

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/pause',
      payload: { request_id: 'request-1' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/pause',
      payload: { request_id: 'request-1' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(pauseWorkflow).toHaveBeenCalledTimes(1);
    expect(second.json().data).toEqual(first.json().data);
  });

  it('deduplicates repeated workflow resume requests by request_id at the route boundary', async () => {
    const { pool } = createWorkflowControlReplayPool('workflow-1', 'operator_resume_workflow');
    const resumeWorkflow = vi.fn().mockResolvedValue({
      id: 'workflow-1',
      state: 'active',
    });

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
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
      resumeWorkflow,
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', pool);
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

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/resume',
      payload: { request_id: 'request-1' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/resume',
      payload: { request_id: 'request-1' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(resumeWorkflow).toHaveBeenCalledTimes(1);
    expect(second.json().data).toEqual(first.json().data);
  });

  it('deduplicates repeated workflow document creation requests by request_id', async () => {
    const { pool } = createTransactionalWorkflowReplayPool(
      'workflow-1',
      'operator_create_workflow_document',
    );
    vi.mocked(createWorkflowDocument).mockResolvedValue({
      logical_name: 'spec',
      scope: 'workflow',
      source: 'repository',
      path: 'docs/spec.md',
      metadata: {},
      created_at: '2026-03-12T00:00:00.000Z',
    });

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
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
    app.decorate('pgPool', pool);
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

    const payload = {
      request_id: 'request-1',
      logical_name: 'spec',
      source: 'repository',
      path: 'docs/spec.md',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/documents',
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/documents',
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(createWorkflowDocument).toHaveBeenCalledTimes(1);
    expect(createWorkflowDocument).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.any(Function) }),
      'tenant-1',
      'workflow-1',
      {
        logical_name: 'spec',
        source: 'repository',
        path: 'docs/spec.md',
      },
    );
    expect(second.json().data).toEqual(first.json().data);
  });

  it('deduplicates repeated workflow document update requests by request_id', async () => {
    const { pool } = createTransactionalWorkflowReplayPool(
      'workflow-1',
      'operator_update_workflow_document',
    );
    vi.mocked(updateWorkflowDocument).mockResolvedValue({
      logical_name: 'spec',
      scope: 'workflow',
      source: 'repository',
      path: 'docs/spec-v2.md',
      metadata: {},
      created_at: '2026-03-12T00:00:00.000Z',
    });

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
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
    app.decorate('pgPool', pool);
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

    const payload = {
      request_id: 'request-1',
      path: 'docs/spec-v2.md',
    };
    const first = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workflows/workflow-1/documents/spec',
      payload,
    });
    const second = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workflows/workflow-1/documents/spec',
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(updateWorkflowDocument).toHaveBeenCalledTimes(1);
    expect(updateWorkflowDocument).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.any(Function) }),
      'tenant-1',
      'workflow-1',
      'spec',
      {
        path: 'docs/spec-v2.md',
      },
    );
    expect(second.json().data).toEqual(first.json().data);
  });

  it('deduplicates repeated workflow document delete requests by request_id', async () => {
    const { pool } = createTransactionalWorkflowReplayPool(
      'workflow-1',
      'operator_delete_workflow_document',
    );
    vi.mocked(deleteWorkflowDocument).mockResolvedValue(undefined);

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
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
    app.decorate('pgPool', pool);
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

    const first = await app.inject({
      method: 'DELETE',
      url: '/api/v1/workflows/workflow-1/documents/spec?request_id=request-1',
    });
    const second = await app.inject({
      method: 'DELETE',
      url: '/api/v1/workflows/workflow-1/documents/spec?request_id=request-1',
    });

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
    expect(deleteWorkflowDocument).toHaveBeenCalledTimes(1);
    expect(deleteWorkflowDocument).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.any(Function) }),
      'tenant-1',
      'workflow-1',
      'spec',
    );
  });
});
