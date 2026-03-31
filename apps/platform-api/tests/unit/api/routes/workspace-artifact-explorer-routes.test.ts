import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../src/errors/error-handler.js';

const listWorkspaceArtifacts = vi.fn();

vi.mock('../../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'agent-key',
    };
  },
  withScope: () => async () => {},
  withAllowedScopes: () => async () => {},
}));

vi.mock('../../../../src/services/workspace-artifact-explorer/workspace-artifact-explorer-service.js', () => ({
  WorkspaceArtifactExplorerService: vi.fn().mockImplementation(() => ({
    listWorkspaceArtifacts,
  })),
}));

describe('workspace artifact explorer routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('serves workspace-scoped artifact queries through the bounded explorer route', async () => {
    const { workspaceRoutes } = await import('../../../../src/api/routes/workspaces.routes.js');

    listWorkspaceArtifacts.mockResolvedValue({
      data: [],
      meta: {
        page: 1,
        per_page: 50,
        total: 0,
        total_pages: 1,
        has_more: false,
        summary: {
          total_artifacts: 0,
          previewable_artifacts: 0,
          total_bytes: 0,
          workflow_count: 0,
          work_item_count: 0,
          task_count: 0,
          role_count: 0,
        },
        filters: {
          workflows: [],
          work_items: [],
          tasks: [],
          stages: [],
          roles: [],
          content_types: [],
        },
      },
    });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {});
    app.decorate('eventService', {});
    app.decorate('workflowService', { getWorkspaceTimeline: vi.fn() });
    app.decorate('workspaceService', {
      createWorkspace: vi.fn(),
      getWorkspace: vi.fn().mockResolvedValue({ id: 'workspace-1' }),
      updateWorkspace: vi.fn(),
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
      setGitWebhookConfig: vi.fn(),
      deleteWorkspace: vi.fn(),
      listWorkspaces: vi.fn(),
    });
    app.decorate('workspaceArtifactFileService', {
      listWorkspaceArtifactFiles: vi.fn(),
      uploadWorkspaceArtifactFile: vi.fn(),
      uploadWorkspaceArtifactFiles: vi.fn(),
      deleteWorkspaceArtifactFile: vi.fn(),
      downloadWorkspaceArtifactFile: vi.fn(),
    });
    app.decorate('config', {
      ARTIFACT_PREVIEW_MAX_BYTES: 1024 * 1024,
    });

    await app.register(workspaceRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/workspace-1/artifacts?q=release&preview_mode=inline&page=2&per_page=50',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listWorkspaceArtifacts).toHaveBeenCalledWith('tenant-1', 'workspace-1', {
      q: 'release',
      preview_mode: 'inline',
      page: 2,
      per_page: 50,
    });
  });

  it('rejects invalid workspace artifact explorer query values', async () => {
    const { workspaceRoutes } = await import('../../../../src/api/routes/workspaces.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {});
    app.decorate('eventService', {});
    app.decorate('workflowService', { getWorkspaceTimeline: vi.fn() });
    app.decorate('workspaceService', {
      createWorkspace: vi.fn(),
      getWorkspace: vi.fn(),
      updateWorkspace: vi.fn(),
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
      setGitWebhookConfig: vi.fn(),
      deleteWorkspace: vi.fn(),
      listWorkspaces: vi.fn(),
    });
    app.decorate('workspaceArtifactFileService', {
      listWorkspaceArtifactFiles: vi.fn(),
      uploadWorkspaceArtifactFile: vi.fn(),
      uploadWorkspaceArtifactFiles: vi.fn(),
      deleteWorkspaceArtifactFile: vi.fn(),
      downloadWorkspaceArtifactFile: vi.fn(),
    });
    app.decorate('config', {
      ARTIFACT_PREVIEW_MAX_BYTES: 1024 * 1024,
    });

    await app.register(workspaceRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/workspace-1/artifacts?preview_mode=bad&page=0',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });
});
