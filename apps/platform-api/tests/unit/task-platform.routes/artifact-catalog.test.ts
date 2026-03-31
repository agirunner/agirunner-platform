import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../src/errors/domain-errors.js';
import { taskPlatformRoutes } from '../../../src/api/routes/task-platform.routes.js';
import { createTaskPlatformApp, createWorkflowReplayPool, VALID_ARTIFACT_ID } from './support.js';

const downloadArtifactForTaskScope = vi.fn();
const listArtifactsForTaskScope = vi.fn();
const previewArtifactForTaskScope = vi.fn();

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

vi.mock('../../../src/services/artifact-catalog-service.js', () => ({
  ArtifactCatalogService: vi.fn().mockImplementation(() => ({
    listArtifactsForTaskScope,
    downloadArtifactForTaskScope,
    previewArtifactForTaskScope,
  })),
  parseArtifactCatalogArtifactId: (value: string) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new ValidationError('artifact_id must be a valid uuid');
    }
    return value;
  },
}));

describe('task platform routes - artifact catalog', () => {
  let app: ReturnType<typeof fastify> | undefined;

  afterEach(async () => {
    vi.clearAllMocks();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('uses the artifact logical filename for catalog downloads', async () => {
    downloadArtifactForTaskScope.mockResolvedValue({
      artifact: {
        logical_path: 'docs/spec.md',
      },
      contentType: 'text/plain; charset=utf-8',
      data: Buffer.from('hello'),
    });

    app = await createTaskPlatformApp({
      pgPool: createWorkflowReplayPool('workflow-1', 'task_memory_patch'),
      workspaceService: {},
    }, (currentApp) => currentApp.register(taskPlatformRoutes));

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/task-1/artifact-catalog/${VALID_ARTIFACT_ID}`,
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toBe('attachment; filename="spec.md"');
    expect(response.body).toBe('hello');
  });

  it('rejects malformed artifact ids before calling the artifact catalog service', async () => {
    app = await createTaskPlatformApp({
      pgPool: createWorkflowReplayPool('workflow-1', 'task_memory_patch'),
      workspaceService: {},
    }, (currentApp) => currentApp.register(taskPlatformRoutes));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/task-1/artifact-catalog/not-a-uuid',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('artifact_id must be a valid uuid');
    expect(downloadArtifactForTaskScope).not.toHaveBeenCalled();
  });
});
