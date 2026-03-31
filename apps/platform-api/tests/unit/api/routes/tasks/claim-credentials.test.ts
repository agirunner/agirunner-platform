import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTaskRouteApp, mockWithAllowedScopes, resetTaskRouteAuthMocks } from './support.js';

describe('tasks routes claim credentials', () => {
  let app: ReturnType<typeof buildTaskRouteApp> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    resetTaskRouteAuthMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('resolves claim credential handles through the agent task route', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks.routes.js');
    const resolveClaimCredentials = vi.fn(async () => ({ llm_api_key: 'resolved-api-key' }));

    app = buildTaskRouteApp({ resolveClaimCredentials });
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/11111111-1111-1111-1111-111111111111/claim-credentials',
      headers: { authorization: 'Bearer test' },
      payload: {
        llm_api_key_claim_handle: 'claim:v1:test.test',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(resolveClaimCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      '11111111-1111-1111-1111-111111111111',
      { llm_api_key_claim_handle: 'claim:v1:test.test' },
    );
  });

  it('accepts remote MCP claim handles through the agent task route', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks.routes.js');
    const resolveClaimCredentials = vi.fn(async () => ({ mcp_claim_values: { 'claim:v1:mcp-1': 'resolved-remote-secret' } }));

    app = buildTaskRouteApp({ resolveClaimCredentials });
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/11111111-1111-1111-1111-111111111111/claim-credentials',
      headers: { authorization: 'Bearer test' },
      payload: {
        mcp_claim_handles: ['claim:v1:mcp-1'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(resolveClaimCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      '11111111-1111-1111-1111-111111111111',
      { mcp_claim_handles: ['claim:v1:mcp-1'] },
    );
  });

  it('registers PATCH /api/v1/tasks/:id using withAllowedScopes with worker and admin', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks.routes.js');

    app = buildTaskRouteApp({});
    await app.register(taskRoutes);

    expect(mockWithAllowedScopes).toHaveBeenCalledWith(expect.arrayContaining(['worker', 'admin']));
  });
});
