import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

const { withScopeSpy } = vi.hoisted(() => ({
  withScopeSpy: vi.fn(() => async () => {}),
}));

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-key',
    };
  },
  withScope: withScopeSpy,
}));

describe('task stream routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  afterEach(async () => {
    vi.clearAllMocks();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  function buildApp({
    getTask = vi.fn(),
    getWorker = vi.fn(),
  }: {
    getTask?: ReturnType<typeof vi.fn>;
    getWorker?: ReturnType<typeof vi.fn>;
  } = {}) {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('taskService', { getTask } as never);
    app.decorate('workerService', { getWorker } as never);
    return { app, getTask, getWorker };
  }

  it('returns 404 when task has no assigned_worker_id', async () => {
    const { app: appInstance, getTask } = buildApp();
    getTask.mockResolvedValue({
      id: 'task-1',
      state: 'in_progress',
      assigned_worker_id: null,
    });

    const { taskStreamRoutes } = await import('../../src/api/routes/task-stream.routes.js');
    await appInstance.register(taskStreamRoutes);

    const response = await appInstance.inject({
      method: 'GET',
      url: '/api/v1/tasks/00000000-0000-4000-8000-000000000001/stream',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'task_not_streaming' });
  });

  it('returns 404 when task state is not in_progress', async () => {
    const { app: appInstance, getTask } = buildApp();
    getTask.mockResolvedValue({
      id: 'task-1',
      state: 'pending',
      assigned_worker_id: 'worker-1',
    });

    const { taskStreamRoutes } = await import('../../src/api/routes/task-stream.routes.js');
    await appInstance.register(taskStreamRoutes);

    const response = await appInstance.inject({
      method: 'GET',
      url: '/api/v1/tasks/00000000-0000-4000-8000-000000000001/stream',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'task_not_streaming' });
  });

  it('returns 502 when worker has no api_url in host_info', async () => {
    const { app: appInstance, getTask, getWorker } = buildApp();
    getTask.mockResolvedValue({
      id: 'task-1',
      state: 'in_progress',
      assigned_worker_id: 'worker-1',
    });
    getWorker.mockResolvedValue({
      id: 'worker-1',
      host_info: {},
    });

    const { taskStreamRoutes } = await import('../../src/api/routes/task-stream.routes.js');
    await appInstance.register(taskStreamRoutes);

    const response = await appInstance.inject({
      method: 'GET',
      url: '/api/v1/tasks/00000000-0000-4000-8000-000000000001/stream',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: 'runtime_unreachable' });
  });

  it('returns 502 when worker has null host_info', async () => {
    const { app: appInstance, getTask, getWorker } = buildApp();
    getTask.mockResolvedValue({
      id: 'task-1',
      state: 'in_progress',
      assigned_worker_id: 'worker-1',
    });
    getWorker.mockResolvedValue({
      id: 'worker-1',
      host_info: null,
    });

    const { taskStreamRoutes } = await import('../../src/api/routes/task-stream.routes.js');
    await appInstance.register(taskStreamRoutes);

    const response = await appInstance.inject({
      method: 'GET',
      url: '/api/v1/tasks/00000000-0000-4000-8000-000000000001/stream',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: 'runtime_unreachable' });
  });

  it('sets correct SSE headers when upstream fetch fails', async () => {
    const { app: appInstance, getTask, getWorker } = buildApp();
    getTask.mockResolvedValue({
      id: 'task-1',
      state: 'in_progress',
      assigned_worker_id: 'worker-1',
    });
    getWorker.mockResolvedValue({
      id: 'worker-1',
      host_info: { api_url: 'http://runtime:8080' },
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const { taskStreamRoutes } = await import('../../src/api/routes/task-stream.routes.js');
    await appInstance.register(taskStreamRoutes);

    const response = await appInstance.inject({
      method: 'GET',
      url: '/api/v1/tasks/00000000-0000-4000-8000-000000000001/stream',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers['connection']).toBe('keep-alive');

    vi.unstubAllGlobals();
  });

  it('requires agent scope — withScope is called with "agent" during route registration', async () => {
    const { app: appInstance } = buildApp();

    const { taskStreamRoutes } = await import('../../src/api/routes/task-stream.routes.js');
    await appInstance.register(taskStreamRoutes);

    expect(withScopeSpy).toHaveBeenCalledWith('agent');
  });
});
