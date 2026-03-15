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

  it('persists create-time model_overrides into workflow metadata', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const createWorkflow = vi.fn().mockResolvedValue({ id: 'workflow-1' });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {});
    app.decorate('projectService', { getProject: vi.fn() });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    });
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
        project_id: '22222222-2222-2222-2222-222222222222',
        name: 'Workflow',
        metadata: { source: 'launch' },
        model_overrides: {
          developer: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
          },
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(createWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: {
          source: 'launch',
          model_overrides: {
            developer: {
              provider: 'anthropic',
              model: 'claude-sonnet-4-6',
            },
          },
        },
      }),
    );
  });

  it('returns resolved workflow models without project-level override participation', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {});
    app.decorate('projectService', {
      getProject: vi.fn().mockResolvedValue({
        id: 'project-1',
        settings: {},
      }),
    });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn().mockResolvedValue({
        provider: { name: 'openai' },
        model: { modelId: 'gpt-4.1' },
        reasoningConfig: { effort: 'medium' },
      }),
      listProviders: vi.fn().mockResolvedValue([
        { id: 'provider-1', name: 'anthropic', metadata: { providerType: 'anthropic' } },
        { id: 'provider-2', name: 'openai', metadata: { providerType: 'openai' } },
      ]),
      listModels: vi.fn().mockImplementation(async (_tenantId: string, providerId?: string) => {
        if (providerId === 'provider-1') {
          return [
            {
              model_id: 'claude-sonnet-4-6',
              context_window: 200000,
              endpoint_type: 'messages',
              reasoning_config: null,
              is_enabled: true,
            },
            {
              model_id: 'claude-haiku-4',
              context_window: 200000,
              endpoint_type: 'messages',
              reasoning_config: null,
              is_enabled: true,
            },
          ];
        }
        return [
          {
            model_id: 'gpt-4.1',
            context_window: 128000,
            endpoint_type: 'responses',
            reasoning_config: null,
            is_enabled: true,
          },
        ];
      }),
      getProviderForOperations: vi.fn().mockImplementation(async (_tenantId: string, id: string) => ({
        id,
        name: id === 'provider-1' ? 'anthropic' : 'openai',
        metadata: { providerType: id === 'provider-1' ? 'anthropic' : 'openai' },
        base_url: `https://${id}.example.com`,
        api_key_secret_ref: `secret:${id}`,
        auth_mode: 'api_key',
      })),
    });
    app.decorate('workflowService', {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn().mockResolvedValue({
        id: 'workflow-1',
        project_id: 'project-1',
        metadata: {
          model_overrides: {
            developer: {
              provider: 'anthropic',
              model: 'claude-sonnet-4-6',
              reasoning_config: { effort: 'max' },
            },
          },
        },
      }),
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
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/model-overrides/resolved?roles=developer,reviewer',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.project_model_overrides).toEqual({});
    expect(response.json().data.effective_models.developer.source).toBe('workflow');
    expect(response.json().data.effective_models.developer.resolved.model.modelId).toBe(
      'claude-sonnet-4-6',
    );
    expect(response.json().data.effective_models.reviewer.source).toBe('base');
    expect(response.json().data.effective_models.developer.resolved.provider).not.toHaveProperty(
      'apiKeySecretRef',
    );
  });

  it('sanitizes fallback workflow model resolutions when overrides cannot be applied', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {});
    app.decorate('projectService', {
      getProject: vi.fn().mockResolvedValue({
        id: 'project-1',
        settings: {},
      }),
    });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn().mockResolvedValue({
        provider: {
          name: 'openai',
          providerType: 'openai',
          apiKeySecretRef: 'secret:OPENAI_API_KEY',
          oauthCredentials: { access_token: 'enc:v1:token' },
        },
        model: { modelId: 'gpt-5.4' },
        reasoningConfig: { effort: 'medium' },
      }),
      listProviders: vi.fn().mockResolvedValue([]),
      listModels: vi.fn().mockResolvedValue([]),
      getProviderForOperations: vi.fn(),
    });
    app.decorate('workflowService', {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn().mockResolvedValue({
        id: 'workflow-1',
        project_id: 'project-1',
        metadata: {
          model_overrides: {
            developer: {
              provider: 'missing-provider',
              model: 'missing-model',
            },
          },
        },
      }),
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
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/model-overrides/resolved?roles=developer',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.effective_models.developer.fallback).toBe(true);
    expect(response.json().data.effective_models.developer.resolved.provider).toEqual({
      name: 'openai',
      providerType: 'openai',
    });
  });
});
