import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkflowReplayPool,
  createTransactionalWorkflowReplayPool,
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

  it('deduplicates repeated workflow work-item creation requests by request_id', async () => {
    const { workflowRoutes: routes } = { workflowRoutes };
    const { pool, client } = createTransactionalWorkflowReplayPool(
      'workflow-1',
      'operator_create_workflow_work_item',
    );
    const { app: routeApp, workflowService } = createWorkflowWorkItemRoutesApp({
      pgPool: pool as never,
      workflowService: {
        createWorkflowWorkItem: vi.fn(async () => ({
          id: 'wi-1',
          workflow_id: 'workflow-1',
          title: 'Investigate failure',
          stage_name: 'implementation',
        })),
      },
    });
    app = routeApp;
    await app.register(routes);

    const payload = {
      request_id: 'request-1',
      title: 'Investigate failure',
      stage_name: 'implementation',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledTimes(1);
    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      payload,
      client,
    );
    expect(second.json().data).toEqual(first.json().data);
  });

  it('deduplicates repeated workflow work-item update requests by request_id', async () => {
    const { pool, client } = createTransactionalWorkflowReplayPool(
      'workflow-1',
      'operator_update_workflow_work_item',
    );
    const { app: routeApp, workflowService } = createWorkflowWorkItemRoutesApp({
      pgPool: pool as never,
      workflowService: {
        updateWorkflowWorkItem: vi.fn(async () => ({
          id: 'wi-1',
          workflow_id: 'workflow-1',
          notes: 'updated',
        })),
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      notes: 'updated',
    };
    const first = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(workflowService.updateWorkflowWorkItem).toHaveBeenCalledTimes(1);
    expect(workflowService.updateWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      'wi-1',
      { notes: 'updated' },
      client,
    );
    expect(second.json().data).toEqual(first.json().data);
  });

  it('deduplicates workflow work-item skip requests by request_id and preserves work-item ownership validation', async () => {
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_work_item_skip');
    const skipTask = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'completed',
      output: { skipped: true, reason: 'Bypass this work item step.' },
    }));
    const { app: routeApp, taskService, workflowService } = createWorkflowWorkItemRoutesApp({
      pgPool: pool as never,
      taskService: {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
        })),
        skipTask,
      },
      workflowService: {
        listWorkflowWorkItemTasks: vi.fn(async () => [
          {
            id: 'task-1',
            workflow_id: 'workflow-1',
            work_item_id: 'wi-1',
            state: 'failed',
          },
        ]),
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      reason: 'Bypass this work item step.',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/skip',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/skip',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(skipTask).toHaveBeenCalledTimes(1);
    expect(skipTask).toHaveBeenCalledWith(
      {
        id: 'key-1',
        keyPrefix: 'prefix',
        ownerId: 'user-1',
        ownerType: 'user',
        scope: 'admin',
        tenantId: 'tenant-1',
      },
      'task-1',
      { reason: 'Bypass this work item step.' },
    );
    expect(workflowService.listWorkflowWorkItemTasks).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      'wi-1',
    );
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item reassign requests by request_id and preserves ownership validation', async () => {
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_work_item_reassign');
    const reassignTask = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'ready',
      metadata: { preferred_agent_id: 'agent-2', assessment_action: 'reassign' },
    }));
    const { app: routeApp, taskService } = createWorkflowWorkItemRoutesApp({
      pgPool: pool as never,
      taskService: {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
        })),
        reassignTask,
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      preferred_agent_id: '11111111-1111-1111-1111-111111111111',
      reason: 'Move to a better fit',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/reassign',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/reassign',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(reassignTask).toHaveBeenCalledTimes(1);
    expect(reassignTask).toHaveBeenCalledWith(
      {
        id: 'key-1',
        keyPrefix: 'prefix',
        ownerId: 'user-1',
        ownerType: 'user',
        scope: 'admin',
        tenantId: 'tenant-1',
      },
      'task-1',
      expect.objectContaining({
        preferred_agent_id: '11111111-1111-1111-1111-111111111111',
        reason: 'Move to a better fit',
      }),
      expect.any(Object),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });
});
