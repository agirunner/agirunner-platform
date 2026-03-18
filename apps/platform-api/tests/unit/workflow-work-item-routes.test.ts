import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
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

const handoffRouteMocks = {
  listWorkItemHandoffs: vi.fn(async () => [{ id: 'handoff-1', summary: 'ready' }]),
  getLatestWorkItemHandoff: vi.fn(async () => ({ id: 'handoff-1', summary: 'ready' })),
};

vi.mock('../../src/services/handoff-service.js', () => ({
  HandoffService: class {
    listWorkItemHandoffs = handoffRouteMocks.listWorkItemHandoffs;
    getLatestWorkItemHandoff = handoffRouteMocks.getLatestWorkItemHandoff;
  },
}));

describe('workflow work-item routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  function createTransactionalWorkflowReplayPool(workflowId: string, toolName: string) {
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

    return {
      pool: {
        connect: vi.fn(async () => client),
        query: vi.fn(async () => {
          throw new Error('unexpected pool query');
        }),
      },
      client,
    };
  }

  function createWorkflowReplayPool(workflowId: string, toolName: string) {
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

    return {
      pool: {
        connect: vi.fn(async () => client),
        query: vi.fn(async () => {
          throw new Error('unexpected pool query');
        }),
      },
      client,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    handoffRouteMocks.listWorkItemHandoffs.mockResolvedValue([
      { id: 'handoff-1', summary: 'ready' },
    ]);
    handoffRouteMocks.getLatestWorkItemHandoff.mockResolvedValue({
      id: 'handoff-1',
      summary: 'ready',
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('forwards grouped list filters and include-children detail reads', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const workflowService = {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      getWorkflowBoard: vi.fn(),
      listWorkflowStages: vi.fn(),
      listWorkflowWorkItems: vi.fn(async () => [
        { id: 'wi-parent', children_count: 2, is_milestone: true },
      ]),
      createWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItem: vi.fn(async () => ({
        id: 'wi-parent',
        children_count: 2,
        is_milestone: true,
        children: [{ id: 'wi-child-1' }],
      })),
      listWorkflowWorkItemTasks: vi.fn(),
      listWorkflowWorkItemEvents: vi.fn(),
      listWorkItemHandoffs: vi.fn(async () => [{ id: 'handoff-1', summary: 'ready' }]),
      getLatestWorkItemHandoff: vi.fn(async () => ({ id: 'handoff-1', summary: 'ready' })),
      getWorkflowWorkItemMemory: vi.fn(),
      getWorkflowWorkItemMemoryHistory: vi.fn(),
      updateWorkflowWorkItem: vi.fn(),
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('pgPool', { query: vi.fn() } as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

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

  it('deduplicates repeated workflow work-item creation requests by request_id', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const { pool, client } = createTransactionalWorkflowReplayPool(
      'workflow-1',
      'operator_create_workflow_work_item',
    );
    const workflowService = {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      getWorkflowBoard: vi.fn(),
      listWorkflowStages: vi.fn(),
      listWorkflowWorkItems: vi.fn(),
      createWorkflowWorkItem: vi.fn(async () => ({
        id: 'wi-1',
        workflow_id: 'workflow-1',
        title: 'Investigate failure',
        stage_name: 'implementation',
      })),
      getWorkflowWorkItem: vi.fn(),
      listWorkflowWorkItemTasks: vi.fn(),
      listWorkflowWorkItemEvents: vi.fn(),
      getWorkflowWorkItemMemory: vi.fn(),
      getWorkflowWorkItemMemoryHistory: vi.fn(),
      updateWorkflowWorkItem: vi.fn(),
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('pgPool', pool as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      title: 'Investigate failure',
      stage_name: 'implementation',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledTimes(1);
    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      payload,
      client,
    );
    expect(second.json().data).toEqual(first.json().data);
  });

  it('deduplicates repeated workflow work-item update requests by request_id', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const { pool, client } = createTransactionalWorkflowReplayPool(
      'workflow-1',
      'operator_update_workflow_work_item',
    );
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
      updateWorkflowWorkItem: vi.fn(async () => ({
        id: 'wi-1',
        workflow_id: 'workflow-1',
        notes: 'updated',
      })),
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('pgPool', pool as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      notes: 'updated',
    };
    const first = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(workflowService.updateWorkflowWorkItem).toHaveBeenCalledTimes(1);
    expect(workflowService.updateWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      'wi-1',
      { notes: 'updated' },
      client,
    );
    expect(second.json().data).toEqual(first.json().data);
  });

  it('rejects scoped task mutations when the task does not belong to the selected work item', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
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
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };
    const taskService = {
      getTask: vi.fn(async () => ({
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'wi-other',
      })),
      approveTask: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('taskService', taskService as never);
    app.decorate('pgPool', { query: vi.fn() } as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/approve',
      headers: { authorization: 'Bearer test' },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'Task must belong to the selected workflow work item',
        }),
      }),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(taskService.approveTask).not.toHaveBeenCalled();
  });

  it('deduplicates workflow work-item skip requests by request_id and preserves work-item ownership validation', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_work_item_skip');
    const workflowService = {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      getWorkflowBoard: vi.fn(),
      listWorkflowStages: vi.fn(),
      listWorkflowWorkItems: vi.fn(),
      createWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItem: vi.fn(),
      listWorkflowWorkItemTasks: vi.fn(async () => [
        {
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
          state: 'failed',
        },
      ]),
      listWorkflowWorkItemEvents: vi.fn(),
      getWorkflowWorkItemMemory: vi.fn(),
      getWorkflowWorkItemMemoryHistory: vi.fn(),
      updateWorkflowWorkItem: vi.fn(),
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };
    const skipTask = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'completed',
      output: { skipped: true, reason: 'Bypass this work item step.' },
    }));
    const taskService = {
      getTask: vi.fn(async () => ({
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'wi-1',
      })),
      skipTask,
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('taskService', taskService as never);
    app.decorate('pgPool', pool as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      reason: 'Bypass this work item step.',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/skip',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/skip',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(skipTask).toHaveBeenCalledTimes(1);
    expect(skipTask).toHaveBeenCalledWith(
      {
        id: 'key-1',
        keyPrefix: 'prefix',
        ownerId: 'user-1',
        ownerType: 'user',
        scope: 'admin',
        tenantId: 'tenant-1',
      },
      'task-1',
      { reason: 'Bypass this work item step.' },
    );
    expect(workflowService.listWorkflowWorkItemTasks).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      'wi-1',
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item reassign requests by request_id and preserves ownership validation', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_work_item_reassign');
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
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };
    const reassignTask = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'ready',
      metadata: { preferred_agent_id: 'agent-2', review_action: 'reassign' },
    }));
    const taskService = {
      getTask: vi.fn(async () => ({
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'wi-1',
      })),
      reassignTask,
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('taskService', taskService as never);
    app.decorate('pgPool', pool as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      preferred_agent_id: '11111111-1111-1111-1111-111111111111',
      reason: 'Move to a better fit',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/reassign',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/reassign',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(reassignTask).toHaveBeenCalledTimes(1);
    expect(reassignTask).toHaveBeenCalledWith(
      {
        id: 'key-1',
        keyPrefix: 'prefix',
        ownerId: 'user-1',
        ownerType: 'user',
        scope: 'admin',
        tenantId: 'tenant-1',
      },
      'task-1',
      expect.objectContaining({
        preferred_agent_id: '11111111-1111-1111-1111-111111111111',
        reason: 'Move to a better fit',
      }),
      expect.any(Object),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item escalation resolution requests by request_id', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_resolve_escalation');
    const workflowService = {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      getWorkflowBoard: vi.fn(),
      listWorkflowStages: vi.fn(),
      listWorkflowWorkItems: vi.fn(),
      createWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItem: vi.fn(),
      listWorkflowWorkItemTasks: vi.fn(async () => [
        {
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
          state: 'escalated',
        },
      ]),
      listWorkflowWorkItemEvents: vi.fn(),
      getWorkflowWorkItemMemory: vi.fn(),
      getWorkflowWorkItemMemoryHistory: vi.fn(),
      updateWorkflowWorkItem: vi.fn(),
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };
    const resolveEscalation = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'ready',
      metadata: { escalation_resolved: true },
    }));
    const taskService = {
      getTask: vi.fn(async () => ({
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'wi-1',
      })),
      resolveEscalation,
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('taskService', taskService as never);
    app.decorate('pgPool', pool as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      instructions: 'Resume once the escalation rationale is captured.',
      context: { owner: 'operator' },
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/resolve-escalation',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/resolve-escalation',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(resolveEscalation).toHaveBeenCalledTimes(1);
    expect(resolveEscalation).toHaveBeenCalledWith(
      {
        id: 'key-1',
        keyPrefix: 'prefix',
        ownerId: 'user-1',
        ownerType: 'user',
        scope: 'admin',
        tenantId: 'tenant-1',
      },
      'task-1',
      {
        instructions: 'Resume once the escalation rationale is captured.',
        context: { owner: 'operator' },
      },
    );
    expect(second.json()).toEqual(first.json());
  });

  it('rejects resolve escalation when the task does not belong to the selected work item', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
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
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };
    const taskService = {
      getTask: vi.fn(async () => ({
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'wi-other',
      })),
      resolveEscalation: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('taskService', taskService as never);
    app.decorate('pgPool', { query: vi.fn() } as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/resolve-escalation',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-1',
        instructions: 'Resume after operator guidance.',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'Task must belong to the selected workflow work item',
        }),
      }),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(taskService.resolveEscalation).not.toHaveBeenCalled();
  });

  it('deduplicates workflow work-item retry requests and force-retries escalated recovery steps', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_work_item_retry');
    const workflowService = {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      getWorkflowBoard: vi.fn(),
      listWorkflowStages: vi.fn(),
      listWorkflowWorkItems: vi.fn(),
      createWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItem: vi.fn(),
      listWorkflowWorkItemTasks: vi.fn(async () => [
        {
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
          state: 'escalated',
        },
      ]),
      listWorkflowWorkItemEvents: vi.fn(),
      getWorkflowWorkItemMemory: vi.fn(),
      getWorkflowWorkItemMemoryHistory: vi.fn(),
      updateWorkflowWorkItem: vi.fn(),
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };
    const retryTask = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'ready',
      output: { retried: true },
    }));
    const taskService = {
      getTask: vi.fn(async () => ({
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'wi-1',
      })),
      retryTask,
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('taskService', taskService as never);
    app.decorate('pgPool', pool as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/retry',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/retry',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(workflowService.listWorkflowWorkItemTasks).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      'wi-1',
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(retryTask).toHaveBeenCalledTimes(1);
    expect(retryTask).toHaveBeenCalledWith(
      {
        id: 'key-1',
        keyPrefix: 'prefix',
        ownerId: 'user-1',
        ownerType: 'user',
        scope: 'admin',
        tenantId: 'tenant-1',
      },
      'task-1',
      { override_input: undefined, force: true },
      expect.any(Object),
    );
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item task approve requests by request_id', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_approve');
    const approveTask = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'completed',
    }));
    const taskService = {
      getTask: vi.fn(async () => ({
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'wi-1',
      })),
      approveTask,
    };
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
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('taskService', taskService as never);
    app.decorate('pgPool', pool as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const payload = { request_id: 'request-1' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/approve',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/approve',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(approveTask).toHaveBeenCalledTimes(1);
    expect(approveTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-1',
      expect.any(Object),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item task approve-output requests by request_id', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_approve_output');
    const approveTaskOutput = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'completed',
      output: { result: 'approved' },
    }));
    const taskService = {
      getTask: vi.fn(async () => ({
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'wi-1',
      })),
      approveTaskOutput,
    };
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
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('taskService', taskService as never);
    app.decorate('pgPool', pool as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const payload = { request_id: 'request-1' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/approve-output',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/approve-output',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(approveTaskOutput).toHaveBeenCalledTimes(1);
    expect(approveTaskOutput).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-1',
      expect.any(Object),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item task reject requests by request_id', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_reject');
    const rejectTask = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'ready',
      metadata: { review_action: 'rejected' },
    }));
    const taskService = {
      getTask: vi.fn(async () => ({
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'wi-1',
      })),
      rejectTask,
    };
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
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('taskService', taskService as never);
    app.decorate('pgPool', pool as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const payload = { request_id: 'request-1', feedback: 'Output quality insufficient.' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/reject',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/reject',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(rejectTask).toHaveBeenCalledTimes(1);
    expect(rejectTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-1',
      { feedback: 'Output quality insufficient.' },
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item task request-changes requests by request_id', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_request_changes');
    const requestTaskChanges = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'ready',
      metadata: { review_action: 'request_changes' },
    }));
    const taskService = {
      getTask: vi.fn(async () => ({
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'wi-1',
      })),
      requestTaskChanges,
    };
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
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('taskService', taskService as never);
    app.decorate('pgPool', pool as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      feedback: 'Needs better error handling.',
      override_input: { hints: 'Add try-catch' },
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/request-changes',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/request-changes',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(requestTaskChanges).toHaveBeenCalledTimes(1);
    expect(requestTaskChanges).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-1',
      { feedback: 'Needs better error handling.', override_input: { hints: 'Add try-catch' } },
      expect.any(Object),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item task cancel requests by request_id', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_cancel');
    const cancelTask = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'cancelled',
    }));
    const taskService = {
      getTask: vi.fn(async () => ({
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'wi-1',
      })),
      cancelTask,
    };
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
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('taskService', taskService as never);
    app.decorate('pgPool', pool as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const payload = { request_id: 'request-1' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/cancel',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/cancel',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(cancelTask).toHaveBeenCalledTimes(1);
    expect(cancelTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-1',
      expect.any(Object),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item task output-override requests by request_id', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_output_override');
    const overrideTaskOutput = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'completed',
      output: { overridden: true },
    }));
    const taskService = {
      getTask: vi.fn(async () => ({
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'wi-1',
      })),
      overrideTaskOutput,
    };
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
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('taskService', taskService as never);
    app.decorate('pgPool', pool as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      output: { corrected: true, summary: 'Manual override applied.' },
      reason: 'Agent produced incorrect output.',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/output-override',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/output-override',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(overrideTaskOutput).toHaveBeenCalledTimes(1);
    expect(overrideTaskOutput).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-1',
      { output: { corrected: true, summary: 'Manual override applied.' }, reason: 'Agent produced incorrect output.' },
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });

  it('rejects output-override when the task does not belong to the selected work item', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const taskService = {
      getTask: vi.fn(async () => ({
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'wi-other',
      })),
      overrideTaskOutput: vi.fn(),
    };
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
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('taskService', taskService as never);
    app.decorate('pgPool', { query: vi.fn() } as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('projectService', { getProject: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/output-override',
      headers: { authorization: 'Bearer test' },
      payload: {
        output: { corrected: true },
        reason: 'Agent produced incorrect output.',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'Task must belong to the selected workflow work item',
        }),
      }),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(taskService.overrideTaskOutput).not.toHaveBeenCalled();
  });
});
