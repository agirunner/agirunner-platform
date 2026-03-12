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
}));

describe('workflow work-item routes', () => {
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

    expect(listResponse.statusCode).toBe(200);
    expect(detailResponse.statusCode).toBe(200);
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
  });
});
