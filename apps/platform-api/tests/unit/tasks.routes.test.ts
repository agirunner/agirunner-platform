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
      expect.objectContaining({ state: 'in_progress' }),
    );
  });

  it('passes escalation task filters through the public task query route', async () => {
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
      url: '/api/v1/tasks?workflow_id=wf-1&escalation_task_id=task-esc-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listTasks).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        workflow_id: 'wf-1',
        escalation_task_id: 'task-esc-1',
      }),
    );
  });

  it('rejects invalid task ids on the task status route before calling the service', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const getTask = vi.fn();

    app = fastify();
    registerErrorHandler(app);
    app.decorate('taskService', {
      listTasks: vi.fn(),
      createTask: vi.fn(),
      getTask,
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
      url: '/api/v1/tasks/<task_id_from_previous_step>',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('task id must be a valid uuid');
    expect(getTask).not.toHaveBeenCalled();
  });

  it('rejects legacy task state aliases at the query boundary', async () => {
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

  it('resolves claim credential handles through the agent task route', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const resolveClaimCredentials = vi.fn(async () => ({
      llm_api_key: 'resolved-api-key',
    }));

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
      resolveClaimCredentials,
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

  it('deduplicates repeated patch requests by request_id for workflow-backed tasks', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const updateTask = vi.fn(async () => ({
      id: 'task-patch-1',
      workflow_id: 'workflow-patch-1',
      metadata: { note: 'patched once' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-patch-1', workflow_id: 'workflow-patch-1' })),
        updateTask,
      },
      createWorkflowReplayPool('workflow-patch-1', 'task_update'),
    );
    await app.register(taskRoutes);

    const payload = {
      request_id: 'task-patch-request-1',
      metadata: { note: 'patched once' },
    };

    const first = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tasks/task-patch-1',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tasks/task-patch-1',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenCalledWith('tenant-1', 'task-patch-1', {
      metadata: { note: 'patched once' },
    });
    expect(second.json()).toEqual(first.json());
  });

  it('rejects raw approve requests for workflow-backed tasks even when request_id is repeated', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const approveTask = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      state: 'ready',
      metadata: { review_action: 'approve' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-1', workflow_id: 'workflow-1' })),
        approveTask,
      },
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

  it('rejects raw approve mutations for work-item-linked workflow tasks', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
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
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
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

  it('still allows raw approve mutations for standalone tasks', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const approveTask = vi.fn(async () => ({
      id: 'task-standalone-approve-1',
      workflow_id: null,
      state: 'ready',
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({
          id: 'task-standalone-approve-1',
          workflow_id: null,
        })),
        approveTask,
      },
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

  it('rejects raw approve-output requests for workflow-backed tasks even when request_id is repeated', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const approveTaskOutput = vi.fn(async () => ({
      id: 'task-2',
      workflow_id: 'workflow-2',
      state: 'completed',
      metadata: { review_action: 'approve_output' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-2', workflow_id: 'workflow-2' })),
        approveTaskOutput,
      },
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
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const cancelTask = vi.fn(async () => ({
      id: 'task-3',
      workflow_id: 'workflow-3',
      state: 'cancelled',
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-3', workflow_id: 'workflow-3' })),
        cancelTask,
      },
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

  it('deduplicates repeated complete requests by request_id for workflow-backed tasks', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const completeTask = vi.fn(async () => ({
      id: 'task-4',
      workflow_id: 'workflow-4',
      state: 'completed',
      output: { summary: 'Completed once' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-4', workflow_id: 'workflow-4' })),
        completeTask,
      },
      createWorkflowReplayPool('workflow-4', 'task_complete'),
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
      url: '/api/v1/tasks/task-4/complete',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-4/complete',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(completeTask).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated fail requests by request_id for workflow-backed tasks', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const failTask = vi.fn(async () => ({
      id: 'task-5',
      workflow_id: 'workflow-5',
      state: 'failed',
      error: { message: 'Execution failed once' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-5', workflow_id: 'workflow-5' })),
        failTask,
      },
      createWorkflowReplayPool('workflow-5', 'task_fail'),
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
      url: '/api/v1/tasks/task-5/fail',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-5/fail',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(failTask).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated complete requests by request_id for standalone tasks', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const completeTask = vi.fn(async () => ({
      id: 'task-standalone-complete-1',
      workflow_id: null,
      state: 'completed',
      output: { summary: 'Standalone completed once' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-standalone-complete-1', workflow_id: null })),
        completeTask,
      },
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

function buildTaskRouteApp(
  overrides: Record<string, unknown>,
  pool?: {
    connect: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  },
) {
  const app = fastify();
  registerErrorHandler(app);
  if (pool) {
    app.decorate('pgPool', pool as never);
  }
  app.decorate('taskService', createTaskService(overrides) as never);
  return app;
}

function createTaskService(overrides?: Record<string, unknown>) {
  return {
    listTasks: vi.fn(),
    createTask: vi.fn(),
    getTask: vi.fn(),
    updateTask: vi.fn(),
    getTaskContext: vi.fn(),
    getTaskGitActivity: vi.fn(),
    claimTask: vi.fn(),
    resolveClaimCredentials: vi.fn(),
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
    ...(overrides ?? {}),
  };
}

function createWorkflowReplayPool(
  workflowId: string,
  toolName: string,
) {
  const storedResults = new Map<string, Record<string, unknown>>();
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT response') && sql.includes('FROM workflow_tool_results')) {
        expect(params).toEqual(['tenant-1', workflowId, toolName, expect.any(String)]);
        const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}:${params?.[3]}`;
        const response = storedResults.get(key);
        return response
          ? { rowCount: 1, rows: [{ response }] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO workflow_tool_results')) {
        expect(params).toEqual(['tenant-1', workflowId, toolName, expect.any(String), expect.any(Object)]);
        const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}:${params?.[3]}`;
        const response = params?.[4] as Record<string, unknown>;
        const existing = storedResults.get(key);
        if (existing) {
          return { rowCount: 0, rows: [] };
        }
        storedResults.set(key, response);
        return { rowCount: 1, rows: [{ response }] };
      }
      throw new Error(`Unexpected SQL in replay pool: ${sql}`);
    }),
    release: vi.fn(),
  };

  return {
    connect: vi.fn(async () => client),
    query: vi.fn(),
  };
}

function createTaskReplayPool(
  taskId: string,
  toolName: string,
) {
  const storedResults = new Map<string, Record<string, unknown>>();
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT response') && sql.includes('FROM task_tool_results')) {
        expect(params).toEqual(['tenant-1', taskId, toolName, expect.any(String)]);
        const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}:${params?.[3]}`;
        const response = storedResults.get(key);
        return response
          ? { rowCount: 1, rows: [{ response }] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO task_tool_results')) {
        expect(params).toEqual(['tenant-1', taskId, toolName, expect.any(String), expect.any(Object)]);
        const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}:${params?.[3]}`;
        const response = params?.[4] as Record<string, unknown>;
        const existing = storedResults.get(key);
        if (existing) {
          return { rowCount: 0, rows: [] };
        }
        storedResults.set(key, response);
        return { rowCount: 1, rows: [{ response }] };
      }
      throw new Error(`Unexpected SQL in task replay pool: ${sql}`);
    }),
    release: vi.fn(),
  };

  return {
    connect: vi.fn(async () => client),
    query: vi.fn(),
  };
}
