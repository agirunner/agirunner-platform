import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'operator',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
}));

vi.mock('../../../../../src/auth/rbac.js', () => ({
  withRole: () => async () => {},
}));

import { createExecutionLogsApp } from './support.js';

describe('execution logs query filter normalization', () => {
  let app: Awaited<ReturnType<typeof createExecutionLogsApp>>['app'] | undefined;
  let logService: Awaited<ReturnType<typeof createExecutionLogsApp>>['logService'] | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    logService = undefined;
  });

  async function registerRoutes() {
    const registered = await createExecutionLogsApp();
    app = registered.app;
    logService = registered.logService;
  }

  it('treats warn status alias as a level filter on log queries', async () => {
    await registerRoutes();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs?workflow_id=wf-1&status=warn',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(logService!.query).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        workflowId: 'wf-1',
        level: 'warn',
        status: undefined,
      }),
    );
  });

  it('preserves real statuses while normalizing warning aliases', async () => {
    await registerRoutes();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs?workflow_id=wf-1&status=failed,warning',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(logService!.query).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        workflowId: 'wf-1',
        level: 'warn',
        status: ['failed'],
      }),
    );
  });

  it('rejects unknown status aliases with a validation error', async () => {
    await registerRoutes();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs?workflow_id=wf-1&status=banana',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
      },
    });
  });
});
