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
}));

describe('runtime customization routes', () => {
  let app: ReturnType<typeof fastify> | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  function buildApp() {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', {
      RUNTIME_URL: 'http://runtime.example.test',
      RUNTIME_API_KEY: 'runtime-proxy-secret',
    });
    return app;
  }

  it('redacts secret-bearing fields from successful customization proxy responses', async () => {
    const { runtimeCustomizationRoutes } = await import('../../../../../src/api/routes/platform-config/runtime-customization.routes.js');

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          preview: {
            note: 'safe text',
            api_key: 'sk-live-build-secret',
            nested: {
              authorization: 'Bearer header.payload.signature',
              keep_ref: 'secret:RUNTIME_ARTIFACT_TOKEN',
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const appInstance = buildApp();
    await appInstance.register(runtimeCustomizationRoutes);

    const response = await appInstance.inject({
      method: 'POST',
      url: '/api/v1/runtime/customizations/reconstruct/export',
      headers: { authorization: 'Bearer test' },
      payload: { build_id: 'build-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        preview: {
          note: 'safe text',
          api_key: 'redacted://runtime-customization-secret',
          nested: {
            authorization: 'redacted://runtime-customization-secret',
            keep_ref: 'redacted://runtime-customization-secret',
          },
        },
      },
    });
  });

  it('redacts secret-bearing fields from customization proxy error details', async () => {
    const { runtimeCustomizationRoutes } = await import('../../../../../src/api/routes/platform-config/runtime-customization.routes.js');

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message: 'Build failed',
            metadata: {
              password: 'super-secret-password',
              nested: {
                token: 'ghp_live_secret_token',
                token_ref: 'secret:RUNTIME_ARTIFACT_TOKEN',
              },
            },
          },
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      ),
    );

    const appInstance = buildApp();
    await appInstance.register(runtimeCustomizationRoutes);

    const response = await appInstance.inject({
      method: 'POST',
      url: '/api/v1/runtime/customizations/builds',
      headers: { authorization: 'Bearer test' },
      payload: { manifest: { from: 'base' } },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: {
        message: 'Build failed',
        metadata: {
          password: 'redacted://runtime-customization-secret',
          nested: {
            token: 'redacted://runtime-customization-secret',
            token_ref: 'redacted://runtime-customization-secret',
          },
        },
      },
    });
  });
});
