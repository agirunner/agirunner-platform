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

  it('deduplicates workflow work-item task approve requests by request_id', async () => {
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_approve');
    const approveTask = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'completed',
    }));
    const { app: routeApp, taskService } = createWorkflowWorkItemRoutesApp({
      pgPool: pool as never,
      taskService: {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
        })),
        approveTask,
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const payload = { request_id: 'request-1' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/approve',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/approve',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(approveTask).toHaveBeenCalledTimes(1);
    expect(approveTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-1',
      expect.any(Object),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item task approve-output requests by request_id', async () => {
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_approve_output');
    const approveTaskOutput = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'completed',
      output: { result: 'approved' },
    }));
    const { app: routeApp, taskService } = createWorkflowWorkItemRoutesApp({
      pgPool: pool as never,
      taskService: {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
        })),
        approveTaskOutput,
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const payload = { request_id: 'request-1' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/approve-output',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/approve-output',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(approveTaskOutput).toHaveBeenCalledTimes(1);
    expect(approveTaskOutput).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-1',
      expect.any(Object),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item task reject requests by request_id', async () => {
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_reject');
    const rejectTask = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'ready',
      metadata: { assessment_action: 'rejected' },
    }));
    const { app: routeApp, taskService } = createWorkflowWorkItemRoutesApp({
      pgPool: pool as never,
      taskService: {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
        })),
        rejectTask,
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const payload = { request_id: 'request-1', feedback: 'Output quality insufficient.' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/reject',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/reject',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(rejectTask).toHaveBeenCalledTimes(1);
    expect(rejectTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-1',
      { feedback: 'Output quality insufficient.' },
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item task request-changes requests by request_id', async () => {
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_request_changes');
    const requestTaskChanges = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'ready',
      metadata: { assessment_action: 'request_changes' },
    }));
    const { app: routeApp, taskService } = createWorkflowWorkItemRoutesApp({
      pgPool: pool as never,
      taskService: {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
        })),
        requestTaskChanges,
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      feedback: 'Needs better error handling.',
      override_input: { hints: 'Add try-catch' },
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/request-changes',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/request-changes',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(requestTaskChanges).toHaveBeenCalledTimes(1);
    expect(requestTaskChanges).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-1',
      { feedback: 'Needs better error handling.', override_input: { hints: 'Add try-catch' } },
      expect.any(Object),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item task cancel requests by request_id', async () => {
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_cancel');
    const cancelTask = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'cancelled',
    }));
    const { app: routeApp, taskService } = createWorkflowWorkItemRoutesApp({
      pgPool: pool as never,
      taskService: {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
        })),
        cancelTask,
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const payload = { request_id: 'request-1' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/cancel',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/cancel',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(cancelTask).toHaveBeenCalledTimes(1);
    expect(cancelTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-1',
      expect.any(Object),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });

  it('deduplicates workflow work-item task output-override requests by request_id', async () => {
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_output_override');
    const overrideTaskOutput = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      work_item_id: 'wi-1',
      state: 'completed',
      output: { overridden: true },
    }));
    const { app: routeApp, taskService } = createWorkflowWorkItemRoutesApp({
      pgPool: pool as never,
      taskService: {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
        })),
        overrideTaskOutput,
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      output: { corrected: true, summary: 'Manual override applied.' },
      reason: 'Agent produced incorrect output.',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/output-override',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/output-override',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(overrideTaskOutput).toHaveBeenCalledTimes(1);
    expect(overrideTaskOutput).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-1',
      { output: { corrected: true, summary: 'Manual override applied.' }, reason: 'Agent produced incorrect output.' },
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(second.json()).toEqual(first.json());
  });
});
