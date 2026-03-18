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

describe('workspace model override routes', () => {
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

  it('ignores retired workspace model overrides on workspace create instead of rejecting the request', async () => {
    const { workspaceRoutes } = await import('../../src/api/routes/workspaces.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
    app.decorate('pgPool', {});
    app.decorate('eventService', {});
    app.decorate('workflowService', { getWorkspaceTimeline: vi.fn() });
    app.decorate('workspaceService', {
      createWorkspace: vi.fn(),
      getWorkspace: vi.fn(),
      updateWorkspace: vi.fn(),
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
      setGitWebhookConfig: vi.fn(),
      deleteWorkspace: vi.fn(),
      listWorkspaces: vi.fn(),
    });
    app.decorate('workspaceArtifactFileService', {
      listWorkspaceArtifactFiles: vi.fn(),
      uploadWorkspaceArtifactFile: vi.fn(),
      uploadWorkspaceArtifactFiles: vi.fn(),
      deleteWorkspaceArtifactFile: vi.fn(),
      downloadWorkspaceArtifactFile: vi.fn(),
    });

    await app.register(workspaceRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
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

  it('returns shared resolved workspace models without workspace-specific overrides', async () => {
    const { workspaceRoutes } = await import('../../src/api/routes/workspaces.routes.js');

    const getWorkspace = vi.fn().mockResolvedValue({
      id: 'workspace-1',
      settings: {},
    });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
    app.decorate('pgPool', {});
    app.decorate('eventService', {});
    app.decorate('workflowService', { getWorkspaceTimeline: vi.fn() });
    app.decorate('workspaceService', {
      createWorkspace: vi.fn(),
      getWorkspace,
      updateWorkspace: vi.fn(),
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
      setGitWebhookConfig: vi.fn(),
      deleteWorkspace: vi.fn(),
      listWorkspaces: vi.fn(),
    });
    app.decorate('workspaceArtifactFileService', {
      listWorkspaceArtifactFiles: vi.fn(),
      uploadWorkspaceArtifactFile: vi.fn(),
      uploadWorkspaceArtifactFiles: vi.fn(),
      deleteWorkspaceArtifactFile: vi.fn(),
      downloadWorkspaceArtifactFile: vi.fn(),
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

    await app.register(workspaceRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/workspace-1/model-overrides/resolved?roles=developer',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(getWorkspace).toHaveBeenCalledWith('tenant-1', 'workspace-1');
    expect(response.json().data.workspace_model_overrides).toEqual({});
    expect(response.json().data.effective_models.developer.source).toBe('base');
    expect(response.json().data.effective_models.developer.resolved.model.modelId).toBe('gpt-4.1');
    expect(response.json().data.effective_models.developer.resolved.provider).not.toHaveProperty(
      'apiKeySecretRef',
    );
  });

  it('sanitizes base resolved workspace models when no overrides are present', async () => {
    const { workspaceRoutes } = await import('../../src/api/routes/workspaces.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
    app.decorate('pgPool', {});
    app.decorate('eventService', {});
    app.decorate('workflowService', { getWorkspaceTimeline: vi.fn() });
    app.decorate('workspaceService', {
      createWorkspace: vi.fn(),
      getWorkspace: vi.fn().mockResolvedValue({
        id: 'workspace-1',
        settings: {},
      }),
      updateWorkspace: vi.fn(),
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
      setGitWebhookConfig: vi.fn(),
      deleteWorkspace: vi.fn(),
      listWorkspaces: vi.fn(),
    });
    app.decorate('workspaceArtifactFileService', {
      listWorkspaceArtifactFiles: vi.fn(),
      uploadWorkspaceArtifactFile: vi.fn(),
      uploadWorkspaceArtifactFiles: vi.fn(),
      deleteWorkspaceArtifactFile: vi.fn(),
      downloadWorkspaceArtifactFile: vi.fn(),
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

    await app.register(workspaceRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/workspace-1/model-overrides/resolved?roles=developer',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.effective_models.developer.resolved.provider).toEqual({
      name: 'openai',
      providerType: 'openai',
    });
  });
});
