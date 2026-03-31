import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { taskPlatformRoutes } from '../../../src/api/routes/task-platform/routes.js';
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

describe('task platform routes - memory reads', () => {
  let app: ReturnType<typeof fastify> | undefined;

  afterEach(async () => {
    vi.clearAllMocks();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('filters task memory reads to the current workflow and work item scope', async () => {
    app = await createTaskPlatformApp({
      pgPool: {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('SELECT id, workflow_id, workspace_id')) {
            return {
              rowCount: 1,
              rows: [buildTaskRow({ stage_name: 'requirements' })],
            };
          }
          if (sql.includes('FROM events')) {
            return {
              rowCount: 2,
              rows: [
                {
                  id: 21,
                  type: 'workspace.memory_updated',
                  actor_type: 'agent',
                  actor_id: 'agent:key',
                  created_at: '2026-03-16T08:00:00.000Z',
                  data: { key: 'global_note' },
                },
                {
                  id: 22,
                  type: 'workspace.memory_updated',
                  actor_type: 'agent',
                  actor_id: 'agent:key',
                  created_at: '2026-03-16T08:01:00.000Z',
                  data: { key: 'stale_dispatch', workflow_id: 'workflow-old' },
                },
              ],
            };
          }
          throw new Error(`Unexpected SQL in task memory read test: ${sql}`);
        }),
      },
      workspaceService: {
        getWorkspace: vi.fn().mockResolvedValue({
          id: 'workspace-1',
          memory: {
            global_note: 'keep this',
            stale_dispatch: 'hide this',
          },
        }),
        patchWorkspaceMemory: vi.fn(),
        patchWorkspaceMemoryEntries: vi.fn(),
      },
    }, (currentApp) => currentApp.register(taskPlatformRoutes));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/task-1/memory',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.memory).toEqual({
      global_note: 'keep this',
    });
  });

  it('supports batch task memory reads with repeated keys query parameters', async () => {
    app = await createTaskPlatformApp({
      pgPool: {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('SELECT id, workflow_id, workspace_id')) {
            return {
              rowCount: 1,
              rows: [buildTaskRow({ stage_name: 'requirements' })],
            };
          }
          if (sql.includes('FROM events')) {
            return {
              rowCount: 3,
              rows: [
                {
                  id: 21,
                  type: 'workspace.memory_updated',
                  actor_type: 'agent',
                  actor_id: 'agent:key',
                  created_at: '2026-03-16T08:00:00.000Z',
                  data: { key: 'global_note' },
                },
                {
                  id: 22,
                  type: 'workspace.memory_updated',
                  actor_type: 'agent',
                  actor_id: 'agent:key',
                  created_at: '2026-03-16T08:01:00.000Z',
                  data: { key: 'same_work_item', workflow_id: 'workflow-1', work_item_id: 'work-item-1' },
                },
                {
                  id: 23,
                  type: 'workspace.memory_updated',
                  actor_type: 'agent',
                  actor_id: 'agent:key',
                  created_at: '2026-03-16T08:02:00.000Z',
                  data: { key: 'stale_dispatch', workflow_id: 'workflow-old' },
                },
              ],
            };
          }
          throw new Error(`Unexpected SQL in batch task memory read test: ${sql}`);
        }),
      },
      workspaceService: {
        getWorkspace: vi.fn().mockResolvedValue({
          id: 'workspace-1',
          memory: {
            global_note: 'keep this',
            same_work_item: 'keep item note',
            stale_dispatch: 'hide this',
          },
        }),
        patchWorkspaceMemory: vi.fn(),
        patchWorkspaceMemoryEntries: vi.fn(),
      },
    }, (currentApp) => currentApp.register(taskPlatformRoutes));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/task-1/memory?keys=global_note&keys=same_work_item&keys=stale_dispatch',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.memory).toEqual({
      global_note: 'keep this',
      same_work_item: 'keep item note',
    });
  });

  it('searches visible task memory case-insensitively', async () => {
    app = await createTaskPlatformApp({
      pgPool: {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('SELECT id, workflow_id, workspace_id')) {
            return {
              rowCount: 1,
              rows: [buildTaskRow({ stage_name: 'requirements' })],
            };
          }
          if (sql.includes('FROM events')) {
            return {
              rowCount: 3,
              rows: [
                {
                  id: 21,
                  type: 'workspace.memory_updated',
                  actor_type: 'agent',
                  actor_id: 'agent:key',
                  created_at: '2026-03-16T08:00:00.000Z',
                  data: { key: 'global_note' },
                },
                {
                  id: 22,
                  type: 'workspace.memory_updated',
                  actor_type: 'agent',
                  actor_id: 'agent:key',
                  created_at: '2026-03-16T08:01:00.000Z',
                  data: { key: 'decision_log', workflow_id: 'workflow-1' },
                },
                {
                  id: 23,
                  type: 'workspace.memory_updated',
                  actor_type: 'agent',
                  actor_id: 'agent:key',
                  created_at: '2026-03-16T08:02:00.000Z',
                  data: { key: 'stale_dispatch', workflow_id: 'workflow-old' },
                },
              ],
            };
          }
          throw new Error(`Unexpected SQL in task memory search test: ${sql}`);
        }),
      },
      workspaceService: {
        getWorkspace: vi.fn().mockResolvedValue({
          id: 'workspace-1',
          memory: {
            global_note: 'keep this',
            decision_log: { outcome: 'Ship now' },
            stale_dispatch: 'ship old flow',
          },
        }),
        patchWorkspaceMemory: vi.fn(),
        patchWorkspaceMemoryEntries: vi.fn(),
      },
    }, (currentApp) => currentApp.register(taskPlatformRoutes));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/task-1/memory/search?q=SHIP',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.matches).toEqual([
      {
        key: 'decision_log',
        value: { outcome: 'Ship now' },
        event_id: 22,
        updated_at: '2026-03-16T08:01:00.000Z',
        actor_type: 'agent',
        actor_id: 'agent:key',
        workflow_id: 'workflow-1',
        work_item_id: null,
        task_id: null,
        stage_name: null,
      },
    ]);
  });
});
