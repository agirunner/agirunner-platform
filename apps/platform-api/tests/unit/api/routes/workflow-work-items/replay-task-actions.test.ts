import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkflowReplayPool,
  createWorkflowWorkItemRoutesApp,
  resetWorkflowWorkItemRouteMocks,
  workflowRoutes,
} from './support.js';

describe('workflow work-item routes', () => {
  let app: ReturnType<typeof createWorkflowWorkItemRoutesApp>['app'] | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    resetWorkflowWorkItemRouteMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('deduplicates workflow work-item escalation resolution requests by request_id', async () => {
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_resolve_escalation');
    const resolveEscalation = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'ready',
      metadata: { escalation_resolved: true },
    }));
    const { app: routeApp, taskService } = createWorkflowWorkItemRoutesApp({
      pgPool: pool as never,
      taskService: {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
        })),
        resolveEscalation,
      },
      workflowService: {
        listWorkflowWorkItemTasks: vi.fn(async () => [
          {
            id: 'task-1',
            workflow_id: 'workflow-1',
            work_item_id: 'wi-1',
            state: 'escalated',
          },
        ]),
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      instructions: 'Resume once the escalation rationale is captured.',
      context: { owner: 'operator' },
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/resolve-escalation',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/resolve-escalation',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(resolveEscalation).toHaveBeenCalledTimes(1);
    expect(resolveEscalation).toHaveBeenCalledWith(
      {
        id: 'key-1',
        keyPrefix: 'prefix',
        ownerId: 'user-1',
        ownerType: 'user',
        scope: 'admin',
        tenantId: 'tenant-1',
      },
      'task-1',
      {
        instructions: 'Resume once the escalation rationale is captured.',
        context: { owner: 'operator' },
      },
    );
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item resolve-escalation actions by request_id', async () => {
    const { pool } = createWorkflowReplayPool(
      'workflow-1',
      'operator_resolve_work_item_escalation',
    );
    const { app: routeApp, workflowService } = createWorkflowWorkItemRoutesApp({
      pgPool: pool as never,
      workflowService: {
        resolveWorkflowWorkItemEscalation: vi.fn(async () => ({
          id: 'wi-1',
          workflow_id: 'workflow-1',
          escalation_status: null,
        })),
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      action: 'dismiss',
      feedback: 'Handled in the latest work item update.',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/resolve-escalation',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/resolve-escalation',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(workflowService.resolveWorkflowWorkItemEscalation).toHaveBeenCalledTimes(1);
    expect(workflowService.resolveWorkflowWorkItemEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      'wi-1',
      {
        action: 'dismiss',
        feedback: 'Handled in the latest work item update.',
      },
      expect.any(Object),
    );
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item agent-escalate requests', async () => {
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_agent_escalate');
    const agentEscalate = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'escalated',
    }));
    const { app: routeApp, taskService } = createWorkflowWorkItemRoutesApp({
      pgPool: pool as never,
      taskService: {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
        })),
        agentEscalate,
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      reason: 'Need operator guidance before proceeding.',
      context_summary: 'The workflow is waiting on a human decision.',
      work_so_far: 'Completed the repository-backed deliverable and submitted the handoff.',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/agent-escalate',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/agent-escalate',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(agentEscalate).toHaveBeenCalledTimes(1);
    expect(agentEscalate).toHaveBeenCalledWith(
      {
        id: 'key-1',
        keyPrefix: 'prefix',
        ownerId: 'user-1',
        ownerType: 'user',
        scope: 'admin',
        tenantId: 'tenant-1',
      },
      'task-1',
      {
        reason: 'Need operator guidance before proceeding.',
        context_summary: 'The workflow is waiting on a human decision.',
        work_so_far: 'Completed the repository-backed deliverable and submitted the handoff.',
      },
    );
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item retry requests and force-retries escalated recovery steps', async () => {
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_work_item_retry');
    const retryTask = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'ready',
      output: { retried: true },
    }));
    const { app: routeApp, taskService, workflowService } = createWorkflowWorkItemRoutesApp({
      pgPool: pool as never,
      taskService: {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
        })),
        retryTask,
      },
      workflowService: {
        listWorkflowWorkItemTasks: vi.fn(async () => [
          {
            id: 'task-1',
            workflow_id: 'workflow-1',
            work_item_id: 'wi-1',
            state: 'escalated',
          },
        ]),
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/retry',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/retry',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(workflowService.listWorkflowWorkItemTasks).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      'wi-1',
    );
    expect(retryTask).toHaveBeenCalledTimes(1);
    expect(retryTask).toHaveBeenCalledWith(
      {
        id: 'key-1',
        keyPrefix: 'prefix',
        ownerId: 'user-1',
        ownerType: 'user',
        scope: 'admin',
        tenantId: 'tenant-1',
      },
      'task-1',
      { override_input: undefined, force: true },
      expect.any(Object),
    );
    expect(second.json()).toEqual(first.json());
  });
});
