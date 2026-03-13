import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'admin-1',
    };
  },
  withScope: () => async () => {},
  withAllowedScopes: () => async () => {},
}));

describe('public task operator route idempotency', () => {
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

  it('deduplicates repeated retry requests by request_id', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const retryTask = vi.fn(async () => ({
      id: 'task-retry-1',
      workflow_id: 'workflow-retry-1',
      state: 'ready',
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-retry-1', workflow_id: 'workflow-retry-1' })),
        retryTask,
      },
      createWorkflowReplayPool('workflow-retry-1', 'public_task_retry', 'retry-1'),
    );
    await app.register(taskRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-retry-1/retry',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'retry-1', force: true, override_input: { branch: 'hotfix' } },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-retry-1/retry',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'retry-1', force: true, override_input: { branch: 'hotfix' } },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(retryTask).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated reject requests by request_id', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const rejectTask = vi.fn(async () => ({
      id: 'task-reject-1',
      workflow_id: 'workflow-reject-1',
      state: 'failed',
      metadata: { review_action: 'reject' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-reject-1', workflow_id: 'workflow-reject-1' })),
        rejectTask,
      },
      createWorkflowReplayPool('workflow-reject-1', 'public_task_reject', 'reject-1'),
    );
    await app.register(taskRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-reject-1/reject',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'reject-1', feedback: 'Need a different approach.' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-reject-1/reject',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'reject-1', feedback: 'Need a different approach.' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(rejectTask).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates request-changes aliases across rework and request-changes routes', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const requestTaskChanges = vi.fn(async () => ({
      id: 'task-rework-1',
      workflow_id: 'workflow-rework-1',
      state: 'ready',
      metadata: { review_action: 'request_changes' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-rework-1', workflow_id: 'workflow-rework-1' })),
        requestTaskChanges,
      },
      createWorkflowReplayPool(
        'workflow-rework-1',
        'public_task_request_changes',
        'request-changes-1',
      ),
    );
    await app.register(taskRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-rework-1/rework',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-changes-1',
        feedback: 'Please adjust the implementation notes.',
        preferred_agent_id: '11111111-1111-1111-1111-111111111111',
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-rework-1/request-changes',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-changes-1',
        feedback: 'Please adjust the implementation notes.',
        preferred_agent_id: '11111111-1111-1111-1111-111111111111',
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(requestTaskChanges).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated skip requests by request_id', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const skipTask = vi.fn(async () => ({
      id: 'task-skip-1',
      workflow_id: 'workflow-skip-1',
      state: 'completed',
      output: { skipped: true, reason: 'Not applicable' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-skip-1', workflow_id: 'workflow-skip-1' })),
        skipTask,
      },
      createWorkflowReplayPool('workflow-skip-1', 'public_task_skip', 'skip-1'),
    );
    await app.register(taskRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-skip-1/skip',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'skip-1', reason: 'Not applicable' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-skip-1/skip',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'skip-1', reason: 'Not applicable' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(skipTask).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated reassign requests by request_id', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const reassignTask = vi.fn(async () => ({
      id: 'task-reassign-1',
      workflow_id: 'workflow-reassign-1',
      state: 'ready',
      metadata: { review_action: 'reassign' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-reassign-1', workflow_id: 'workflow-reassign-1' })),
        reassignTask,
      },
      createWorkflowReplayPool('workflow-reassign-1', 'public_task_reassign', 'reassign-1'),
    );
    await app.register(taskRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-reassign-1/reassign',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'reassign-1',
        reason: 'Assign to the database specialist.',
        preferred_worker_id: '22222222-2222-2222-2222-222222222222',
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-reassign-1/reassign',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'reassign-1',
        reason: 'Assign to the database specialist.',
        preferred_worker_id: '22222222-2222-2222-2222-222222222222',
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(reassignTask).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated escalate requests by request_id', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const escalateTask = vi.fn(async () => ({
      id: 'task-escalate-1',
      workflow_id: 'workflow-escalate-1',
      state: 'escalated',
      metadata: { review_action: 'escalate' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-escalate-1', workflow_id: 'workflow-escalate-1' })),
        escalateTask,
      },
      createWorkflowReplayPool('workflow-escalate-1', 'public_task_escalate', 'escalate-1'),
    );
    await app.register(taskRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-escalate-1/escalate',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'escalate-1', reason: 'Need human approval.', escalation_target: 'human' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-escalate-1/escalate',
      headers: { authorization: 'Bearer test' },
      payload: { request_id: 'escalate-1', reason: 'Need human approval.', escalation_target: 'human' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(escalateTask).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated escalation-response requests by request_id', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const respondToEscalation = vi.fn(async () => ({
      id: 'task-response-1',
      workflow_id: 'workflow-response-1',
      state: 'in_progress',
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-response-1', workflow_id: 'workflow-response-1' })),
        respondToEscalation,
      },
      createWorkflowReplayPool(
        'workflow-response-1',
        'public_task_escalation_response',
        'escalation-response-1',
      ),
    );
    await app.register(taskRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-response-1/escalation-response',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'escalation-response-1',
        instructions: 'Proceed with the migration after backup.',
        context: { approver: 'ops' },
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-response-1/escalation-response',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'escalation-response-1',
        instructions: 'Proceed with the migration after backup.',
        context: { approver: 'ops' },
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(respondToEscalation).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated output-override requests by request_id', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const overrideTaskOutput = vi.fn(async () => ({
      id: 'task-output-1',
      workflow_id: 'workflow-output-1',
      state: 'completed',
      output: { summary: 'Overridden output' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-output-1', workflow_id: 'workflow-output-1' })),
        overrideTaskOutput,
      },
      createWorkflowReplayPool(
        'workflow-output-1',
        'public_task_output_override',
        'output-override-1',
      ),
    );
    await app.register(taskRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-output-1/output-override',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'output-override-1',
        output: { summary: 'Overridden output' },
        reason: 'Use the human-reviewed version.',
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-output-1/output-override',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'output-override-1',
        output: { summary: 'Overridden output' },
        reason: 'Use the human-reviewed version.',
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(overrideTaskOutput).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated resolve-escalation requests by request_id', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const resolveEscalation = vi.fn(async () => ({
      id: 'task-resolve-1',
      workflow_id: 'workflow-resolve-1',
      state: 'ready',
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-resolve-1', workflow_id: 'workflow-resolve-1' })),
        resolveEscalation,
      },
      createWorkflowReplayPool(
        'workflow-resolve-1',
        'public_task_resolve_escalation',
        'resolve-escalation-1',
      ),
    );
    await app.register(taskRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-resolve-1/resolve-escalation',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'resolve-escalation-1',
        instructions: 'Resume with the updated risk controls.',
        context: { approved_by: 'cto' },
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-resolve-1/resolve-escalation',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'resolve-escalation-1',
        instructions: 'Resume with the updated risk controls.',
        context: { approved_by: 'cto' },
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(resolveEscalation).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates repeated agent-escalate requests by request_id', async () => {
    const { taskRoutes } = await import('../../src/api/routes/tasks.routes.js');
    const agentEscalate = vi.fn(async () => ({
      id: 'task-agent-escalate-1',
      workflow_id: 'workflow-agent-escalate-1',
      state: 'escalated',
      metadata: { escalated_by: 'agent' },
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({
          id: 'task-agent-escalate-1',
          workflow_id: 'workflow-agent-escalate-1',
        })),
        agentEscalate,
      },
      createWorkflowReplayPool(
        'workflow-agent-escalate-1',
        'public_task_agent_escalate',
        'agent-escalate-1',
      ),
    );
    await app.register(taskRoutes);

    const payload = {
      request_id: 'agent-escalate-1',
      reason: 'Need orchestration guidance before continuing.',
      context_summary: 'Schema migration is blocked on unclear ownership.',
      work_so_far: 'Validated the migration plan and collected current schema drift.',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-agent-escalate-1/agent-escalate',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-agent-escalate-1/agent-escalate',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(agentEscalate).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });
});

function buildTaskRouteApp(
  overrides: Record<string, unknown>,
  pool: {
    connect: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  },
) {
  const app = fastify();
  registerErrorHandler(app);
  app.decorate('pgPool', pool as never);
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
  requestId: string,
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
        expect(params).toEqual(['tenant-1', workflowId, toolName, requestId]);
        const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}:${params?.[3]}`;
        const response = storedResults.get(key);
        return response
          ? { rowCount: 1, rows: [{ response }] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO workflow_tool_results')) {
        expect(params).toEqual(['tenant-1', workflowId, toolName, requestId, expect.any(Object)]);
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
