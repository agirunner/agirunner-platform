import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'worker',
      ownerType: 'worker',
      ownerId: 'worker-1',
      keyPrefix: 'worker-key',
    };
  },
  withScope: () => async () => {},
}));

describe('workers routes', () => {
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

  it('rejects legacy capabilities on worker registration', async () => {
    const { workerRoutes } = await import('../../src/api/routes/workers.routes.js');
    const registerWorker = vi.fn();

    app = fastify();
    registerErrorHandler(app);
    app.decorate('taskService', { claimTask: vi.fn() });
    app.decorate('pgPool', { query: vi.fn() });
    app.decorate('workerService', {
      registerWorker,
      listWorkers: vi.fn(),
      getWorker: vi.fn(),
      deleteWorker: vi.fn(),
      heartbeat: vi.fn(),
      sendSignal: vi.fn(),
    });

    await app.register(workerRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workers/register',
      headers: { authorization: 'Bearer test' },
      payload: {
        name: 'runtime-1',
        capabilities: ['coding'],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(registerWorker).not.toHaveBeenCalled();
  });

  it('rejects legacy capabilities on next-task claim', async () => {
    const { workerRoutes } = await import('../../src/api/routes/workers.routes.js');
    const claimTask = vi.fn();

    app = fastify();
    registerErrorHandler(app);
    app.decorate('taskService', { claimTask });
    app.decorate('pgPool', {
      query: vi.fn(async () => ({ rowCount: 1, rows: [{ id: 'agent-1', worker_id: 'worker-1' }] })),
    });
    app.decorate('workerService', {
      registerWorker: vi.fn(),
      listWorkers: vi.fn(),
      getWorker: vi.fn(async () => ({ id: 'worker-1', routing_tags: ['role:developer'] })),
      deleteWorker: vi.fn(),
      heartbeat: vi.fn(),
      sendSignal: vi.fn(),
    });

    await app.register(workerRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workers/worker-1/next',
      headers: { authorization: 'Bearer test' },
      payload: {
        agent_id: 'agent-1',
        capabilities: ['coding'],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(claimTask).not.toHaveBeenCalled();
  });
});
