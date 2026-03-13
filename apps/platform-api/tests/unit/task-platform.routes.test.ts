import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';
import { taskPlatformRoutes } from '../../src/api/routes/task-platform.routes.js';

const downloadArtifactForTaskScope = vi.fn();
const listArtifactsForTaskScope = vi.fn();
const previewArtifactForTaskScope = vi.fn();

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

vi.mock('../../src/services/artifact-catalog-service.js', () => ({
  ArtifactCatalogService: vi.fn().mockImplementation(() => ({
    listArtifactsForTaskScope,
    downloadArtifactForTaskScope,
    previewArtifactForTaskScope,
  })),
}));

describe('task platform routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  function createWorkflowReplayPool(
    workflowId: string,
    toolName: string,
  ) {
    const storedResults = new Map<string, Record<string, unknown>>();
    const taskRow = {
      id: 'task-1',
      workflow_id: workflowId,
      project_id: 'project-1',
      work_item_id: 'work-item-1',
      stage_name: 'design',
      activation_id: null,
      assigned_agent_id: 'agent-1',
      is_orchestrator_task: false,
      state: 'in_progress',
    };
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
          if (storedResults.has(key)) {
            return { rowCount: 0, rows: [] };
          }
          storedResults.set(key, response);
          return { rowCount: 1, rows: [{ response }] };
        }
        throw new Error(`Unexpected SQL in replay pool client: ${sql}`);
      }),
      release: vi.fn(),
    };

    return {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT id, workflow_id, project_id')) {
          return { rowCount: 1, rows: [taskRow] };
        }
        throw new Error(`Unexpected SQL in replay pool: ${sql}`);
      }),
    };
  }

  afterEach(async () => {
    vi.clearAllMocks();
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

  it('deduplicates repeated task memory patch requests by request_id', async () => {
    const patchProjectMemoryEntries = vi.fn().mockResolvedValue({
      id: 'project-1',
      memory: {
        summary: 'Scoped note',
      },
    });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', createWorkflowReplayPool('workflow-1', 'task_memory_patch') as never);
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

    const payload = {
      request_id: 'memory-patch-1',
      updates: {
        summary: 'Scoped note',
      },
    };

    const first = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tasks/task-1/memory',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tasks/task-1/memory',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(patchProjectMemoryEntries).toHaveBeenCalledTimes(1);
    expect(patchProjectMemoryEntries).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'project-1',
      [{
        key: 'summary',
        value: 'Scoped note',
        context: {
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          stage_name: 'design',
        },
      }],
    );
    expect(second.json()).toEqual(first.json());
  });

  it('uses the artifact logical filename for catalog downloads', async () => {
    downloadArtifactForTaskScope.mockResolvedValue({
      artifact: {
        logical_path: 'docs/spec.md',
      },
      contentType: 'text/plain; charset=utf-8',
      data: Buffer.from('hello'),
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
    app.decorate('projectService', {} as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/task-1/artifact-catalog/artifact-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toBe('attachment; filename="spec.md"');
    expect(response.body).toBe('hello');
  });
});
