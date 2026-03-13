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

  it('deduplicates repeated approve requests by request_id for workflow-backed tasks', async () => {
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

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(approveTask).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated approve-output requests by request_id for workflow-backed tasks', async () => {
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

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(approveTaskOutput).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated cancel requests by request_id for workflow-backed tasks', async () => {
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

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(cancelTask).toHaveBeenCalledTimes(1);
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
