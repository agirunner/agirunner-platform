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

describe('llm config routes', () => {
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

  it('redacts runtime-only provider secrets from direct role resolve responses', async () => {
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
