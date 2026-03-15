import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
  withAllowedScopes: () => async () => {},
}));

describe('project routes', () => {
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

  it('rejects legacy settings.model_override on project create', async () => {
    const { projectRoutes } = await import('../../src/api/routes/projects.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
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

    await app.register(projectRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: 'Bearer test' },
      payload: {
        name: 'Demo',
        slug: 'demo',
        settings: {
          model_override: {
            model_id: '00000000-0000-0000-0000-000000000020',
          },
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('returns project list summaries from the list route unchanged', async () => {
    const { projectRoutes } = await import('../../src/api/routes/projects.routes.js');

    const listProjects = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'project-1',
          name: 'Demo',
          slug: 'demo',
          summary: {
            active_workflow_count: 1,
            completed_workflow_count: 3,
            attention_workflow_count: 2,
            total_workflow_count: 6,
            last_workflow_activity_at: '2026-03-14T09:30:00.000Z',
          },
        },
      ],
      meta: {
        total: 1,
        page: 1,
        per_page: 50,
        pages: 1,
      },
    });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
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
      listProjects,
    });
    app.decorate('projectArtifactFileService', {
      listProjectArtifactFiles: vi.fn(),
      uploadProjectArtifactFile: vi.fn(),
      uploadProjectArtifactFiles: vi.fn(),
      deleteProjectArtifactFile: vi.fn(),
      downloadProjectArtifactFile: vi.fn(),
    });

    await app.register(projectRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/projects?per_page=50',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listProjects).toHaveBeenCalledWith('tenant-1', {
      page: 1,
      per_page: 50,
      q: undefined,
      is_active: undefined,
    });
    expect(response.json()).toEqual({
      data: [
        {
          id: 'project-1',
          name: 'Demo',
          slug: 'demo',
          summary: {
            active_workflow_count: 1,
            completed_workflow_count: 3,
            attention_workflow_count: 2,
            total_workflow_count: 6,
            last_workflow_activity_at: '2026-03-14T09:30:00.000Z',
          },
        },
      ],
      meta: {
        total: 1,
        page: 1,
        per_page: 50,
        pages: 1,
      },
    });
  });

  it('deletes project memory entries through the project admin routes', async () => {
    const { projectRoutes } = await import('../../src/api/routes/projects.routes.js');

    const removeProjectMemory = vi.fn().mockResolvedValue({
      id: 'project-1',
      memory: {},
    });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
    app.decorate('pgPool', {});
    app.decorate('eventService', {});
    app.decorate('workflowService', { getProjectTimeline: vi.fn() });
    app.decorate('projectService', {
      createProject: vi.fn(),
      getProject: vi.fn(),
      updateProject: vi.fn(),
      patchProjectMemory: vi.fn(),
      removeProjectMemory,
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

    await app.register(projectRoutes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/projects/project-1/memory/operator_note',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(removeProjectMemory).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'project-1',
      'operator_note',
    );
  });
});
