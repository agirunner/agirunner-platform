import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/auth/fastify-auth-hook.js', () => ({
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

import { buildTaskRouteApp, createTaskReplayPool, createWorkflowReplayPool } from './support.js';

describe('workflow-linked task operator idempotency', () => {
  let app: Awaited<ReturnType<typeof buildTaskRouteApp>> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('rejects repeated resolve-escalation requests for workflow-linked tasks before replay', async () => {
    const { taskRoutes } = await import('../../../src/api/routes/tasks.routes.js');
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

    expect(first.statusCode).toBe(400);
    expect(second.statusCode).toBe(400);
    expect(resolveEscalation).not.toHaveBeenCalled();
    expect(first.json().error?.code).toBe('VALIDATION_ERROR');
    expect(second.json().error?.code).toBe('VALIDATION_ERROR');
  });

  it('deduplicates repeated start requests by request_id for workflow-backed tasks', async () => {
    const { taskRoutes } = await import('../../../src/api/routes/tasks.routes.js');
    const startTask = vi.fn(async () => ({
      id: 'task-start-1',
      workflow_id: 'workflow-start-1',
      state: 'in_progress',
    }));

    app = buildTaskRouteApp(
      {
        getTask: vi.fn(async () => ({ id: 'task-start-1', workflow_id: 'workflow-start-1' })),
        startTask,
      },
      createWorkflowReplayPool('workflow-start-1', 'task_start', 'start-1'),
    );
    await app.register(taskRoutes);

    const payload = {
      request_id: 'start-1',
      agent_id: '11111111-1111-1111-1111-111111111111',
      started_at: '2026-03-12T22:00:00.000Z',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-start-1/start',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-start-1/start',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(startTask).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });
});
