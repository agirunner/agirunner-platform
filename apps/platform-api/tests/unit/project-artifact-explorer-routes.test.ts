import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

const listProjectArtifacts = vi.fn();

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
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

vi.mock('../../src/services/project-artifact-explorer-service.js', () => ({
  ProjectArtifactExplorerService: vi.fn().mockImplementation(() => ({
    listProjectArtifacts,
  })),
}));

describe('project artifact explorer routes', () => {
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

  it('serves project-scoped artifact queries through the bounded explorer route', async () => {
    const { projectRoutes } = await import('../../src/api/routes/projects.routes.js');

    listProjectArtifacts.mockResolvedValue({
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
    app.decorate('workflowService', { getProjectTimeline: vi.fn() });
    app.decorate('projectService', {
      createProject: vi.fn(),
      getProject: vi.fn().mockResolvedValue({ id: 'project-1' }),
      updateProject: vi.fn(),
      patchProjectMemory: vi.fn(),
      removeProjectMemory: vi.fn(),
      setGitWebhookConfig: vi.fn(),
      deleteProject: vi.fn(),
      listProjects: vi.fn(),
    });
    app.decorate('projectArtifactFileService', {
      listProjectArtifactFiles: vi.fn(),
      uploadProjectArtifactFile: vi.fn(),
      uploadProjectArtifactFiles: vi.fn(),
      deleteProjectArtifactFile: vi.fn(),
      downloadProjectArtifactFile: vi.fn(),
    });
    app.decorate('config', {
      ARTIFACT_PREVIEW_MAX_BYTES: 1024 * 1024,
    });

    await app.register(projectRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-1/artifacts?q=release&preview_mode=inline&page=2&per_page=50',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listProjectArtifacts).toHaveBeenCalledWith('tenant-1', 'project-1', {
      q: 'release',
      preview_mode: 'inline',
      page: 2,
      per_page: 50,
    });
  });

  it('rejects invalid project artifact explorer query values', async () => {
    const { projectRoutes } = await import('../../src/api/routes/projects.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {});
    app.decorate('eventService', {});
    app.decorate('workflowService', { getProjectTimeline: vi.fn() });
    app.decorate('projectService', {
      createProject: vi.fn(),
      getProject: vi.fn(),
      updateProject: vi.fn(),
      patchProjectMemory: vi.fn(),
      removeProjectMemory: vi.fn(),
      setGitWebhookConfig: vi.fn(),
      deleteProject: vi.fn(),
      listProjects: vi.fn(),
    });
    app.decorate('projectArtifactFileService', {
      listProjectArtifactFiles: vi.fn(),
      uploadProjectArtifactFile: vi.fn(),
      uploadProjectArtifactFiles: vi.fn(),
      deleteProjectArtifactFile: vi.fn(),
      downloadProjectArtifactFile: vi.fn(),
    });
    app.decorate('config', {
      ARTIFACT_PREVIEW_MAX_BYTES: 1024 * 1024,
    });

    await app.register(projectRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-1/artifacts?preview_mode=bad&page=0',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });
});
