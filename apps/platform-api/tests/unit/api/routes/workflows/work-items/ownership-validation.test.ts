import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
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

  it('rejects scoped task mutations when the task does not belong to the selected work item', async () => {
    const { app: routeApp, taskService } = createWorkflowWorkItemRoutesApp({
      taskService: {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-other',
        })),
        approveTask: vi.fn(),
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/approve',
      headers: { authorization: 'Bearer test' },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'Task must belong to the selected workflow work item',
        }),
      }),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(taskService.approveTask).not.toHaveBeenCalled();
  });

  it('rejects resolve escalation when the task does not belong to the selected work item', async () => {
    const { app: routeApp, taskService } = createWorkflowWorkItemRoutesApp({
      taskService: {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-other',
        })),
        resolveEscalation: vi.fn(),
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/resolve-escalation',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-1',
        instructions: 'Resume after operator guidance.',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'Task must belong to the selected workflow work item',
        }),
      }),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(taskService.resolveEscalation).not.toHaveBeenCalled();
  });

  it('rejects output-override when the task does not belong to the selected work item', async () => {
    const { app: routeApp, taskService } = createWorkflowWorkItemRoutesApp({
      taskService: {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-other',
        })),
        overrideTaskOutput: vi.fn(),
      },
    });
    app = routeApp;
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/output-override',
      headers: { authorization: 'Bearer test' },
      payload: {
        output: { corrected: true },
        reason: 'Agent produced incorrect output.',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'Task must belong to the selected workflow work item',
        }),
      }),
    );
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(taskService.overrideTaskOutput).not.toHaveBeenCalled();
  });
});
