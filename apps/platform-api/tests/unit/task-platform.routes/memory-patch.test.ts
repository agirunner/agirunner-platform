import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { taskPlatformRoutes } from '../../../src/api/routes/task-platform.routes.js';
import { createTaskPlatformApp, buildTaskRow } from './support.js';

vi.mock('../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-key',
    };
  },
  withScope: () => async () => {},
}));

describe('task platform routes - memory patch', () => {
  let app: ReturnType<typeof fastify> | undefined;

  afterEach(async () => {
    vi.clearAllMocks();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('accepts design-shaped memory updates objects on task memory patch', async () => {
    const patchWorkspaceMemoryEntries = vi.fn().mockResolvedValue({
      id: 'workspace-1',
      memory: {
        summary: 'Scoped note',
        decision: { outcome: 'ship' },
      },
    });

    app = await createTaskPlatformApp({
      pgPool: {
        query: vi.fn().mockResolvedValue({
          rowCount: 1,
          rows: [buildTaskRow()],
        }),
      },
      workspaceService: {
        patchWorkspaceMemory: vi.fn(),
        patchWorkspaceMemoryEntries,
      },
    }, (currentApp) => currentApp.register(taskPlatformRoutes));

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tasks/task-1/memory',
      headers: { authorization: 'Bearer test' },
      payload: {
        updates: {
          summary: 'Scoped note',
          decision: { outcome: 'ship' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(patchWorkspaceMemoryEntries).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workspace-1',
      [
        {
          key: 'summary',
          value: 'Scoped note',
          context: {
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            stage_name: 'design',
          },
        },
        {
          key: 'decision',
          value: { outcome: 'ship' },
          context: {
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            stage_name: 'design',
          },
        },
      ],
    );
    expect(response.json().data.memory).toEqual({
      summary: 'Scoped note',
      decision: { outcome: 'ship' },
    });
  });

  it('rejects task memory patches that try to persist workflow status', async () => {
    const patchWorkspaceMemoryEntries = vi.fn();

    app = await createTaskPlatformApp({
      pgPool: {
        query: vi.fn().mockResolvedValue({
          rowCount: 1,
          rows: [buildTaskRow()],
        }),
      },
      workspaceService: {
        patchWorkspaceMemory: vi.fn(),
        patchWorkspaceMemoryEntries,
      },
    }, (currentApp) => currentApp.register(taskPlatformRoutes));

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tasks/task-1/memory',
      headers: { authorization: 'Bearer test' },
      payload: {
        updates: {
          requirements_gate_status: {
            state: 'awaiting_human_approval',
            checkpoint: 'requirements',
            work_item_id: 'work-item-1',
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(patchWorkspaceMemoryEntries).not.toHaveBeenCalled();
  });
});
