import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';
import { taskPlatformRoutes } from '../../src/api/routes/task-platform.routes.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
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

describe('task platform routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('registers artifact catalog preview and permalink endpoints', async () => {
    app = fastify();
    app.decorate('pgPool', {} as never);
    app.decorate('projectService', {} as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const routes = app.printRoutes();
    expect(routes).toContain('artifact-catalog (GET, HEAD)');
    expect(routes).toContain('review (GET, HEAD)');
    expect(routes).toContain('ermalink (GET, HEAD)');
  });

  it('accepts design-shaped memory updates objects on task memory patch', async () => {
    const patchProjectMemoryEntries = vi.fn().mockResolvedValue({
      id: 'project-1',
      memory: {
        summary: 'Scoped note',
        decision: { outcome: 'ship' },
      },
    });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{
          id: 'task-1',
          workflow_id: 'workflow-1',
          project_id: 'project-1',
          work_item_id: 'work-item-1',
          stage_name: 'design',
          activation_id: null,
          assigned_agent_id: 'agent-1',
          is_orchestrator_task: false,
          state: 'in_progress',
        }],
      }),
    } as never);
    app.decorate('projectService', {
      patchProjectMemory: vi.fn(),
      patchProjectMemoryEntries,
    } as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

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
    expect(patchProjectMemoryEntries).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'project-1',
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
});
