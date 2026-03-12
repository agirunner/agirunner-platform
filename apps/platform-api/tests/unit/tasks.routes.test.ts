import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-1',
    };
  },
  withScope: () => async () => {},
  withAllowedScopes: () => async () => {},
}));

describe('tasks routes', () => {
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

  it('accepts canonical task state filters and translates them for task queries', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const listTasks = vi.fn(async () => ({ data: [], pagination: { page: 1, per_page: 20, total: 0 } }));

    app = fastify();
    registerErrorHandler(app);
    app.decorate('taskService', {
      listTasks,
      createTask: vi.fn(),
      getTask: vi.fn(),
      updateTask: vi.fn(),
      getTaskContext: vi.fn(),
      getTaskGitActivity: vi.fn(),
      claimTask: vi.fn(),
      startTask: vi.fn(),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      approveTask: vi.fn(),
      approveTaskOutput: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
      rejectTask: vi.fn(),
      requestTaskChanges: vi.fn(),
      skipTask: vi.fn(),
      reassignTask: vi.fn(),
      escalateTask: vi.fn(),
      respondToEscalation: vi.fn(),
      overrideTaskOutput: vi.fn(),
      agentEscalate: vi.fn(),
      resolveEscalation: vi.fn(),
    });

    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?state=in_progress',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listTasks).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ state: 'running' }),
    );
  });

  it('accepts legacy task state aliases and translates them for task queries', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const listTasks = vi.fn(async () => ({ data: [], pagination: { page: 1, per_page: 20, total: 0 } }));

    app = fastify();
    registerErrorHandler(app);
    app.decorate('taskService', {
      listTasks,
      createTask: vi.fn(),
      getTask: vi.fn(),
      updateTask: vi.fn(),
      getTaskContext: vi.fn(),
      getTaskGitActivity: vi.fn(),
      claimTask: vi.fn(),
      startTask: vi.fn(),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      approveTask: vi.fn(),
      approveTaskOutput: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
      rejectTask: vi.fn(),
      requestTaskChanges: vi.fn(),
      skipTask: vi.fn(),
      reassignTask: vi.fn(),
      escalateTask: vi.fn(),
      respondToEscalation: vi.fn(),
      overrideTaskOutput: vi.fn(),
      agentEscalate: vi.fn(),
      resolveEscalation: vi.fn(),
    });

    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?state=awaiting_escalation',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listTasks).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ state: 'awaiting_escalation' }),
    );
  });

  it('rejects invalid task state filters', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('taskService', {
      listTasks: vi.fn(),
      createTask: vi.fn(),
      getTask: vi.fn(),
      updateTask: vi.fn(),
      getTaskContext: vi.fn(),
      getTaskGitActivity: vi.fn(),
      claimTask: vi.fn(),
      startTask: vi.fn(),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      approveTask: vi.fn(),
      approveTaskOutput: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
      rejectTask: vi.fn(),
      requestTaskChanges: vi.fn(),
      skipTask: vi.fn(),
      reassignTask: vi.fn(),
      escalateTask: vi.fn(),
      respondToEscalation: vi.fn(),
      overrideTaskOutput: vi.fn(),
      agentEscalate: vi.fn(),
      resolveEscalation: vi.fn(),
    });

    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?state=still_running',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(expect.objectContaining({
      error: {
        code: 'VALIDATION_ERROR',
        message: "Invalid task state 'still_running'",
      },
    }));
  });
});
