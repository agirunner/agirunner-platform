import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTaskRouteApp, resetTaskRouteAuthMocks } from './support.js';

describe('tasks routes validation and query boundaries', () => {
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

  it('accepts canonical task state filters and translates them for task queries', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks/routes.js');
    const listTasks = vi.fn(async () => ({ data: [], pagination: { page: 1, per_page: 20, total: 0 } }));

    app = buildTaskRouteApp({ listTasks });
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?state=in_progress',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listTasks).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ state: 'in_progress' }),
    );
  });

  it('passes escalation task filters through the public task query route', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks/routes.js');
    const listTasks = vi.fn(async () => ({ data: [], pagination: { page: 1, per_page: 20, total: 0 } }));

    app = buildTaskRouteApp({ listTasks });
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?workflow_id=11111111-1111-4111-8111-111111111111&escalation_task_id=task-esc-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listTasks).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        workflow_id: '11111111-1111-4111-8111-111111111111',
        escalation_task_id: 'task-esc-1',
      }),
    );
  });

  it('rejects invalid task ids on the task status route before calling the service', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks/routes.js');
    const getTask = vi.fn();

    app = buildTaskRouteApp({ getTask });
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/<task_id_from_previous_step>',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('task id must be a valid uuid');
    expect(getTask).not.toHaveBeenCalled();
  });

  it('rejects invalid work item filters on task listing before calling the service', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks/routes.js');
    const listTasks = vi.fn();

    app = buildTaskRouteApp({ listTasks });
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?work_item_id=wi_4d7c5ff0',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('work_item_id must be a valid uuid');
    expect(listTasks).not.toHaveBeenCalled();
  });

  it('rejects legacy capabilities_required on task creation', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks/routes.js');
    const createTask = vi.fn();

    app = buildTaskRouteApp({ createTask });
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        title: 'Legacy task',
        type: 'custom',
        capabilities_required: ['coding'],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('rejects runtime_only execution backend on specialist task creation', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks/routes.js');
    const createTask = vi.fn();

    app = buildTaskRouteApp({ createTask });
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        title: 'Implement change',
        type: 'code',
        is_orchestrator_task: false,
        execution_backend: 'runtime_only',
      },
    });

    const body = response.json();
    expect(response.statusCode).toBe(422);
    expect(body.error.message).toContain('Invalid request body');
    expect(JSON.stringify(body.error.details)).toContain(
      'specialist tasks must use execution_backend runtime_plus_task',
    );
    expect(createTask).not.toHaveBeenCalled();
  });

  it('rejects legacy review task types on task creation', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks/routes.js');
    const createTask = vi.fn();

    app = buildTaskRouteApp({ createTask });
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        title: 'Legacy review task',
        type: 'review',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('rejects runtime_only execution backend on non-orchestrator task creation', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks/routes.js');
    const createTask = vi.fn();

    app = buildTaskRouteApp({ createTask });
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        title: 'Illegal task',
        type: 'custom',
        is_orchestrator_task: false,
        execution_backend: 'runtime_only',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('rejects legacy governance flags on task creation', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks/routes.js');
    const createTask = vi.fn();

    app = buildTaskRouteApp({ createTask });
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        title: 'Legacy task',
        type: 'custom',
        requires_approval: true,
        requires_assessment: true,
      },
    });

    expect(response.statusCode).toBe(422);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('rejects legacy task state aliases at the query boundary', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks/routes.js');
    const listTasks = vi.fn(async () => ({ data: [], pagination: { page: 1, per_page: 20, total: 0 } }));

    app = buildTaskRouteApp({ listTasks });
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?state=awaiting_escalation',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(400);
    expect(listTasks).not.toHaveBeenCalled();
    expect(response.json()).toEqual(expect.objectContaining({
      error: {
        code: 'VALIDATION_ERROR',
        message: "Invalid task state 'awaiting_escalation'",
      },
    }));
  });

  it('rejects running at the public query boundary', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks/routes.js');
    const listTasks = vi.fn(async () => ({ data: [], pagination: { page: 1, per_page: 20, total: 0 } }));

    app = buildTaskRouteApp({ listTasks });
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?state=running',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(400);
    expect(listTasks).not.toHaveBeenCalled();
    expect(response.json()).toEqual(expect.objectContaining({
      error: {
        code: 'VALIDATION_ERROR',
        message: "Invalid task state 'running'",
      },
    }));
  });

  it('rejects invalid task state filters', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks/routes.js');

    app = buildTaskRouteApp({ listTasks: vi.fn() });
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
