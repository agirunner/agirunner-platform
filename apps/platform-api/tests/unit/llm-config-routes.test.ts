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

describe('llm config model override preview route', () => {
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

  it('validates resolve-preview override payloads', async () => {
    const { llmConfigRoutes } = await import('../../src/api/routes/llm-config.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('modelCatalogService', {});

    await app.register(llmConfigRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/config/llm/resolve-preview',
      headers: { authorization: 'Bearer test' },
      payload: {
        project_model_overrides: {
          developer: {
            provider: '',
            model: 'gpt-5',
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns effective-model preview with workflow overrides taking precedence', async () => {
    const { llmConfigRoutes } = await import('../../src/api/routes/llm-config.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn().mockResolvedValue({
        provider: {
          name: 'openai',
          apiKeySecretRef: 'sk-internal-only',
          accessTokenSecret: 'enc:v1:access',
          extraHeadersSecret: 'enc:v1:headers',
        },
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
          reasoning_config: null,
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

    await app.register(llmConfigRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/config/llm/resolve-preview',
      headers: { authorization: 'Bearer test' },
      payload: {
        project_model_overrides: {
          developer: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
          },
        },
        workflow_model_overrides: {
          developer: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
            reasoning_config: { effort: 'max' },
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.effective_models.developer.source).toBe('workflow');
    expect(response.json().data.effective_models.developer.resolved.reasoningConfig).toEqual({
      effort: 'max',
    });
    expect(response.json().data.effective_models.developer.resolved.provider).not.toHaveProperty(
      'apiKeySecretRef',
    );
    expect(response.json().data.effective_models.developer.resolved.provider).not.toHaveProperty(
      'accessTokenSecret',
    );
    expect(response.json().data.effective_models.developer.resolved.provider).not.toHaveProperty(
      'extraHeadersSecret',
    );
  });

  it('redacts runtime-only provider secrets from resolve responses', async () => {
    const { llmConfigRoutes } = await import('../../src/api/routes/llm-config.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn().mockResolvedValue({
        provider: {
          name: 'openai',
          apiKeySecretRef: 'sk-runtime-secret',
          accessTokenSecret: 'enc:v1:access',
          extraHeadersSecret: 'enc:v1:headers',
          authMode: 'api_key',
        },
        model: { modelId: 'gpt-4.1' },
        reasoningConfig: { effort: 'medium' },
      }),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    });

    await app.register(llmConfigRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/config/llm/resolve/developer',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.provider).toEqual({
      name: 'openai',
      authMode: 'api_key',
    });
  });
});
