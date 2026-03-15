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

describe('project model override routes', () => {
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

  it('ignores retired project model overrides on project create instead of rejecting the request', async () => {
    const { projectRoutes } = await import('../../src/api/routes/projects.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
    app.decorate('pgPool', {});
    app.decorate('eventService', {});
    app.decorate('workflowService', { getProjectTimeline: vi.fn() });
    app.decorate('projectService', {
      createProject: vi.fn(),
      getProject: vi.fn(),
      updateProject: vi.fn(),
      patchProjectMemory: vi.fn(),
      setGitWebhookConfig: vi.fn(),
      deleteProject: vi.fn(),
      listProjects: vi.fn(),
    });

    await app.register(projectRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: 'Bearer test' },
      payload: {
        name: 'Demo',
        slug: 'demo',
        settings: {
          model_overrides: {
            developer: {
              provider: '',
              model: 'gpt-5',
            },
          },
        },
      },
    });

    expect(response.statusCode).toBe(201);
  });

  it('returns shared resolved project models without project-specific overrides', async () => {
    const { projectRoutes } = await import('../../src/api/routes/projects.routes.js');

    const getProject = vi.fn().mockResolvedValue({
      id: 'project-1',
      settings: {},
    });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
    app.decorate('pgPool', {});
    app.decorate('eventService', {});
    app.decorate('workflowService', { getProjectTimeline: vi.fn() });
    app.decorate('projectService', {
      createProject: vi.fn(),
      getProject,
      updateProject: vi.fn(),
      patchProjectMemory: vi.fn(),
      setGitWebhookConfig: vi.fn(),
      deleteProject: vi.fn(),
      listProjects: vi.fn(),
    });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn().mockResolvedValue({
        provider: { name: 'openai' },
        model: { modelId: 'gpt-4.1' },
        reasoningConfig: { effort: 'medium' },
      }),
      listProviders: vi.fn().mockResolvedValue([
        { id: 'provider-1', name: 'anthropic', metadata: { providerType: 'anthropic' } },
      ]),
      listModels: vi.fn().mockResolvedValue([
        {
          model_id: 'claude-sonnet-4-6',
          context_window: 200000,
          endpoint_type: 'messages',
          reasoning_config: { effort: 'medium' },
          is_enabled: true,
        },
      ]),
      getProviderForOperations: vi.fn().mockResolvedValue({
        id: 'provider-1',
        name: 'anthropic',
        metadata: { providerType: 'anthropic' },
        base_url: 'https://api.anthropic.com',
        api_key_secret_ref: 'secret:anthropic',
        auth_mode: 'api_key',
      }),
    });

    await app.register(projectRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-1/model-overrides/resolved?roles=developer',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(getProject).toHaveBeenCalledWith('tenant-1', 'project-1');
    expect(response.json().data.project_model_overrides).toEqual({});
    expect(response.json().data.effective_models.developer.source).toBe('base');
    expect(response.json().data.effective_models.developer.resolved.model.modelId).toBe('gpt-4.1');
    expect(response.json().data.effective_models.developer.resolved.provider).not.toHaveProperty(
      'apiKeySecretRef',
    );
  });

  it('sanitizes base resolved project models when no overrides are present', async () => {
    const { projectRoutes } = await import('../../src/api/routes/projects.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
    app.decorate('pgPool', {});
    app.decorate('eventService', {});
    app.decorate('workflowService', { getProjectTimeline: vi.fn() });
    app.decorate('projectService', {
      createProject: vi.fn(),
      getProject: vi.fn().mockResolvedValue({
        id: 'project-1',
        settings: {},
      }),
      updateProject: vi.fn(),
      patchProjectMemory: vi.fn(),
      setGitWebhookConfig: vi.fn(),
      deleteProject: vi.fn(),
      listProjects: vi.fn(),
    });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn().mockResolvedValue({
        provider: {
          name: 'openai',
          providerType: 'openai',
          apiKeySecretRef: 'secret:OPENAI_API_KEY',
          oauth_credentials: { access_token: 'enc:v1:token' },
        },
        model: { modelId: 'gpt-5.4' },
        reasoningConfig: { effort: 'medium' },
      }),
      listProviders: vi.fn().mockResolvedValue([]),
      listModels: vi.fn().mockResolvedValue([]),
      getProviderForOperations: vi.fn(),
    });

    await app.register(projectRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-1/model-overrides/resolved?roles=developer',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.effective_models.developer.resolved.provider).toEqual({
      name: 'openai',
      providerType: 'openai',
    });
  });
});
