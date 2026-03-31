import { resolve } from 'node:path';
import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { taskArtifactRoutes } from '../../src/api/routes/task-artifacts.routes.js';
import { registerErrorHandler } from '../../src/errors/error-handler.js';

const uploadTaskArtifact = vi.fn();

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
  withAllowedScopes: () => async () => {},
}));

vi.mock('../../src/services/artifact-service.js', () => ({
  ArtifactService: vi.fn().mockImplementation(() => ({
    listTaskArtifacts: vi.fn(),
    uploadTaskArtifact,
    downloadTaskArtifact: vi.fn(),
    previewTaskArtifact: vi.fn(),
    deleteTaskArtifact: vi.fn(),
  })),
}));

describe('task artifact routes', () => {
  const artifactLocalRoot = resolve('tmp/artifacts');
  let app: ReturnType<typeof fastify> | undefined;

  function createWorkflowReplayPool(workflowId: string, toolName: string) {
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
          expect(params).toEqual(['tenant-1', workflowId, toolName, expect.any(String)]);
          const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}:${params?.[3]}`;
          const response = storedResults.get(key);
          return response
            ? { rowCount: 1, rows: [{ response }] }
            : { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params).toHaveLength(7);
          expect(params?.slice(0, 4)).toEqual(['tenant-1', workflowId, toolName, expect.any(String)]);
          expect(params?.[4]).toEqual(expect.any(Object));
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
    };
  }

  afterEach(async () => {
    vi.clearAllMocks();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('deduplicates repeated artifact uploads by request_id', async () => {
    const getTask = vi.fn().mockResolvedValue({
      id: 'task-1',
      workflow_id: 'workflow-1',
    });
    uploadTaskArtifact.mockResolvedValue({
      id: 'artifact-1',
      task_id: 'task-1',
      logical_path: 'reports/result.json',
    });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', createWorkflowReplayPool('workflow-1', 'task_artifact_upload') as never);
    app.decorate('taskService', { getTask } as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: artifactLocalRoot,
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskArtifactRoutes);

    const payload = {
      request_id: 'artifact-upload-1',
      path: 'reports/result.json',
      content_base64: Buffer.from('ok').toString('base64'),
      content_type: 'application/json',
      metadata: { category: 'report' },
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/artifacts',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/artifacts',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(getTask).toHaveBeenCalledTimes(2);
    expect(uploadTaskArtifact).toHaveBeenCalledTimes(1);
    expect(uploadTaskArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-1',
      {
        path: 'reports/result.json',
        contentBase64: Buffer.from('ok').toString('base64'),
        contentType: 'application/json',
        metadata: { category: 'report' },
      },
    );
    expect(second.json()).toEqual(first.json());
  });
});
