import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTaskRouteApp, createTaskReplayPool, createWorkflowReplayPool, resetTaskRouteAuthMocks } from './support.js';

describe('tasks routes idempotency', () => {
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

  it('deduplicates repeated patch requests by request_id for workflow-backed tasks', async () => {
    const { taskRoutes } = await import('../../../src/api/routes/tasks.routes.js');
    const updateTask = vi.fn(async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      workflow_id: '22222222-2222-4222-8222-222222222222',
      metadata: { note: 'patched once' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111', workflow_id: '22222222-2222-4222-8222-222222222222' })),
        updateTask,
      },
      createWorkflowReplayPool('22222222-2222-4222-8222-222222222222', 'task_update'),
    );
    await app.register(taskRoutes);

    const payload = {
      request_id: 'task-patch-request-1',
      metadata: { note: 'patched once' },
    };

    const first = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tasks/11111111-1111-4111-8111-111111111111',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tasks/11111111-1111-4111-8111-111111111111',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenCalledWith('tenant-1', '11111111-1111-4111-8111-111111111111', {
      metadata: { note: 'patched once' },
    });
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated complete requests by request_id for workflow-backed tasks', async () => {
    const { taskRoutes } = await import('../../../src/api/routes/tasks.routes.js');
    const completeTask = vi.fn(async () => ({
      id: '44444444-4444-4444-8444-444444444444',
      workflow_id: '55555555-5555-4555-8555-555555555555',
      state: 'completed',
      output: { summary: 'Completed once' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: '44444444-4444-4444-8444-444444444444', workflow_id: '55555555-5555-4555-8555-555555555555' })),
        completeTask,
      },
      createWorkflowReplayPool('55555555-5555-4555-8555-555555555555', 'task_complete'),
    );
    await app.register(taskRoutes);

    const payload = {
      request_id: 'complete-1',
      output: { summary: 'Completed once' },
      metrics: { tokens: 123 },
      verification: { checks_passed: true },
      agent_id: '11111111-1111-1111-1111-111111111111',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/44444444-4444-4444-8444-444444444444/complete',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/44444444-4444-4444-8444-444444444444/complete',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(completeTask).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated fail requests by request_id for workflow-backed tasks', async () => {
    const { taskRoutes } = await import('../../../src/api/routes/tasks.routes.js');
    const failTask = vi.fn(async () => ({
      id: '66666666-6666-4666-8666-666666666666',
      workflow_id: '77777777-7777-4777-8777-777777777777',
      state: 'failed',
      error: { message: 'Execution failed once' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: '66666666-6666-4666-8666-666666666666', workflow_id: '77777777-7777-4777-8777-777777777777' })),
        failTask,
      },
      createWorkflowReplayPool('77777777-7777-4777-8777-777777777777', 'task_fail'),
    );
    await app.register(taskRoutes);

    const payload = {
      request_id: 'fail-1',
      error: { message: 'Execution failed once' },
      metrics: { tokens: 456 },
      worker_id: '22222222-2222-2222-2222-222222222222',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/66666666-6666-4666-8666-666666666666/fail',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/66666666-6666-4666-8666-666666666666/fail',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(failTask).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated complete requests by request_id for standalone tasks', async () => {
    const { taskRoutes } = await import('../../../src/api/routes/tasks.routes.js');
    const completeTask = vi.fn(async () => ({
      id: 'task-standalone-complete-1',
      workflow_id: null,
      state: 'completed',
      output: { summary: 'Standalone completed once' },
    }));

    app = buildTaskRouteApp(
      { getTask: vi.fn(async () => ({ id: 'task-standalone-complete-1', workflow_id: null })), completeTask },
      createTaskReplayPool('task-standalone-complete-1', 'task_complete'),
    );
    await app.register(taskRoutes);

    const payload = {
      request_id: 'standalone-complete-1',
      output: { summary: 'Standalone completed once' },
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-standalone-complete-1/complete',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-standalone-complete-1/complete',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(completeTask).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });
});
