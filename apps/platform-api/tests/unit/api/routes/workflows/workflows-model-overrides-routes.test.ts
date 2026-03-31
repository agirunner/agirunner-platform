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

describe('workflow model override routes', () => {
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

  it('rejects legacy create-time model_overrides payloads', async () => {
    const { workflowRoutes } = await import('../../../../../src/api/routes/workflows/routes.js');
    const createWorkflow = vi.fn().mockResolvedValue({ id: 'workflow-1' });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {});
    app.decorate('config', {});
    app.decorate('eventService', {});
    app.decorate('taskService', {});
    app.decorate('workflowRedriveService', {});
    app.decorate('workflowService', {
      createWorkflow,
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      getWorkflowBoard: vi.fn(),
      listWorkflowStages: vi.fn(),
      listWorkflowWorkItems: vi.fn(),
      createWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItemMemory: vi.fn(),
      getWorkflowWorkItemMemoryHistory: vi.fn(),
      updateWorkflowWorkItem: vi.fn(),
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    });

    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: 'Bearer test' },
      payload: {
        playbook_id: '11111111-1111-1111-1111-111111111111',
        workspace_id: '22222222-2222-2222-2222-222222222222',
        name: 'Workflow',
        model_overrides: {
          developer: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(createWorkflow).not.toHaveBeenCalled();
  });

  it('does not expose retired workflow model-routing routes', async () => {
    const { workflowRoutes } = await import('../../../../../src/api/routes/workflows/routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {});
    app.decorate('config', {});
    app.decorate('eventService', {});
    app.decorate('taskService', {});
    app.decorate('workflowRedriveService', {});
    app.decorate('workflowService', {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      getWorkflowBoard: vi.fn(),
      listWorkflowStages: vi.fn(),
      listWorkflowWorkItems: vi.fn(),
      createWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItemMemory: vi.fn(),
      getWorkflowWorkItemMemoryHistory: vi.fn(),
      updateWorkflowWorkItem: vi.fn(),
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    });

    await app.register(workflowRoutes);

    const [plainResponse, resolvedResponse, configResponse] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/api/v1/workflows/workflow-1/model-overrides',
        headers: { authorization: 'Bearer test' },
      }),
      app.inject({
        method: 'GET',
        url: '/api/v1/workflows/workflow-1/model-overrides/resolved?roles=developer',
        headers: { authorization: 'Bearer test' },
      }),
      app.inject({
        method: 'GET',
        url: '/api/v1/workflows/workflow-1/config/resolved?show_layers=true',
        headers: { authorization: 'Bearer test' },
      }),
    ]);

    expect(plainResponse.statusCode).toBe(404);
    expect(resolvedResponse.statusCode).toBe(404);
    expect(configResponse.statusCode).toBe(404);
  });
});
