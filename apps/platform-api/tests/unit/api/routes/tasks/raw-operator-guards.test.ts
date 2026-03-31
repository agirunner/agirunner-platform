import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTaskRouteApp, createTaskReplayPool, createWorkflowReplayPool, resetTaskRouteAuthMocks } from './support.js';

describe('tasks routes raw operator guards', () => {
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

  it('rejects raw approve requests for workflow-backed tasks even when request_id is repeated', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks.routes.js');
    const approveTask = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      state: 'ready',
      metadata: { assessment_action: 'approve' },
    }));

    app = buildTaskRouteApp(
      { getTask: vi.fn(async () => ({ id: 'task-1', workflow_id: 'workflow-1' })), approveTask },
      createWorkflowReplayPool('workflow-1', 'public_task_approve'),
    );
    await app.register(taskRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/approve',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'approve-1' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/approve',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'approve-1' },
    });

    expect(first.statusCode).toBe(400);
    expect(second.statusCode).toBe(400);
    expect(approveTask).not.toHaveBeenCalled();
  });

  it('rejects raw approve-output requests for workflow-backed tasks even when request_id is repeated', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks.routes.js');
    const approveTaskOutput = vi.fn(async () => ({
      id: 'task-2',
      workflow_id: 'workflow-2',
      state: 'completed',
      metadata: { assessment_action: 'approve_output' },
    }));

    app = buildTaskRouteApp(
      { getTask: vi.fn(async () => ({ id: 'task-2', workflow_id: 'workflow-2' })), approveTaskOutput },
      createWorkflowReplayPool('workflow-2', 'public_task_approve_output'),
    );
    await app.register(taskRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-2/approve-output',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'approve-output-1' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-2/approve-output',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'approve-output-1' },
    });

    expect(first.statusCode).toBe(400);
    expect(second.statusCode).toBe(400);
    expect(approveTaskOutput).not.toHaveBeenCalled();
  });

  it('rejects raw cancel requests for workflow-backed tasks even when request_id is repeated', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks.routes.js');
    const cancelTask = vi.fn(async () => ({ id: 'task-3', workflow_id: 'workflow-3', state: 'cancelled' }));

    app = buildTaskRouteApp(
      { getTask: vi.fn(async () => ({ id: 'task-3', workflow_id: 'workflow-3' })), cancelTask },
      createWorkflowReplayPool('workflow-3', 'public_task_cancel'),
    );
    await app.register(taskRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-3/cancel',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'cancel-1' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-3/cancel',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'cancel-1' },
    });

    expect(first.statusCode).toBe(400);
    expect(second.statusCode).toBe(400);
    expect(cancelTask).not.toHaveBeenCalled();
  });

  it('rejects raw resolve-escalation mutations for workflow-linked tasks', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks.routes.js');
    const resolveEscalation = vi.fn(async () => ({
      id: 'task-resolve-guard-1',
      workflow_id: 'workflow-resolve-guard-1',
      work_item_id: 'work-item-resolve-guard-1',
      state: 'ready',
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({
          id: 'task-resolve-guard-1',
          workflow_id: 'workflow-resolve-guard-1',
          work_item_id: 'work-item-resolve-guard-1',
        })),
        resolveEscalation,
      },
      createWorkflowReplayPool('workflow-resolve-guard-1', 'public_task_resolve_escalation'),
    );
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-resolve-guard-1/resolve-escalation',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'resolve-guard-1', instructions: 'Proceed with the staged work-item flow.' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message:
            'Workflow-linked task operator actions must run from the workflow or work-item operator flow.',
        }),
      }),
    );
    expect(resolveEscalation).not.toHaveBeenCalled();
  });

  it('rejects raw approve mutations for work-item-linked workflow tasks', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks.routes.js');
    const approveTask = vi.fn(async () => ({
      id: 'task-work-item-approve-1',
      workflow_id: 'workflow-approve-guard-1',
      work_item_id: 'work-item-approve-guard-1',
      state: 'ready',
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({
          id: 'task-work-item-approve-1',
          workflow_id: 'workflow-approve-guard-1',
          work_item_id: 'work-item-approve-guard-1',
        })),
        approveTask,
      },
      createWorkflowReplayPool('workflow-approve-guard-1', 'public_task_approve'),
    );
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-work-item-approve-1/approve',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'approve-guard-1' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message:
            'Workflow-linked task operator actions must run from the workflow or work-item operator flow.',
        }),
      }),
    );
    expect(approveTask).not.toHaveBeenCalled();
  });

  it('rejects raw cancel mutations for stage-linked workflow tasks without work items', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks.routes.js');
    const cancelTask = vi.fn(async () => ({
      id: 'task-stage-cancel-1',
      workflow_id: 'workflow-cancel-guard-1',
      stage_name: 'qa-review',
      state: 'cancelled',
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({
          id: 'task-stage-cancel-1',
          workflow_id: 'workflow-cancel-guard-1',
          stage_name: 'qa-review',
        })),
        cancelTask,
      },
      createWorkflowReplayPool('workflow-cancel-guard-1', 'public_task_cancel'),
    );
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-stage-cancel-1/cancel',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'cancel-guard-1' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message:
            'Workflow-linked task operator actions must run from the workflow or work-item operator flow.',
        }),
      }),
    );
    expect(cancelTask).not.toHaveBeenCalled();
  });

  it('still allows raw resolve-escalation mutations for standalone tasks', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks.routes.js');
    const resolveEscalation = vi.fn(async () => ({ id: 'task-standalone-resolve-1', workflow_id: null, state: 'ready' }));

    app = buildTaskRouteApp(
      { getTask: vi.fn(async () => ({ id: 'task-standalone-resolve-1', workflow_id: null })), resolveEscalation },
      createTaskReplayPool('task-standalone-resolve-1', 'public_task_resolve_escalation'),
    );
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-standalone-resolve-1/resolve-escalation',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'resolve-standalone-1', instructions: 'Continue with the standalone task.' },
    });

    expect(response.statusCode).toBe(200);
    expect(resolveEscalation).toHaveBeenCalledTimes(1);
  });

  it('still allows raw approve mutations for standalone tasks', async () => {
    const { taskRoutes } = await import('../../../../../src/api/routes/tasks.routes.js');
    const approveTask = vi.fn(async () => ({ id: 'task-standalone-approve-1', workflow_id: null, state: 'ready' }));

    app = buildTaskRouteApp(
      { getTask: vi.fn(async () => ({ id: 'task-standalone-approve-1', workflow_id: null })), approveTask },
      createTaskReplayPool('task-standalone-approve-1', 'public_task_approve'),
    );
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-standalone-approve-1/approve',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'approve-standalone-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(approveTask).toHaveBeenCalledTimes(1);
  });
});
