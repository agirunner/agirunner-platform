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

describe('project artifact file routes', () => {
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

  it('lists project-owned artifact files from a dedicated project route', async () => {
    const { projectRoutes } = await import('../../src/api/routes/projects.routes.js');

    const listProjectArtifactFiles = vi.fn().mockResolvedValue([
      {
        id: 'file-1',
        project_id: 'project-1',
        key: 'design_brief',
        description: 'Source brief for operators',
        file_name: 'brief.md',
        content_type: 'text/markdown',
        size_bytes: 128,
        created_at: '2026-03-14T18:00:00.000Z',
        download_url: '/api/v1/projects/project-1/files/file-1/content',
      },
    ]);

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
      listProjectArtifactFiles,
      uploadProjectArtifactFile: vi.fn(),
      deleteProjectArtifactFile: vi.fn(),
      downloadProjectArtifactFile: vi.fn(),
    });

    await app.register(projectRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-1/files',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listProjectArtifactFiles).toHaveBeenCalledWith('tenant-1', 'project-1');
    expect(response.json().data[0]).toEqual(
      expect.objectContaining({
        project_id: 'project-1',
        key: 'design_brief',
        file_name: 'brief.md',
      }),
    );
  });

  it('uploads project-owned artifact files without requiring workflow or task scope', async () => {
    const { projectRoutes } = await import('../../src/api/routes/projects.routes.js');

    const uploadProjectArtifactFile = vi.fn().mockResolvedValue({
      id: 'file-1',
      project_id: 'project-1',
      key: 'design_brief',
      description: 'Source brief for operators',
      file_name: 'brief.md',
      content_type: 'text/markdown',
      size_bytes: 128,
      created_at: '2026-03-14T18:00:00.000Z',
      download_url: '/api/v1/projects/project-1/files/file-1/content',
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
      listProjects: vi.fn(),
    });
    app.decorate('projectArtifactFileService', {
      listProjectArtifactFiles: vi.fn(),
      uploadProjectArtifactFile,
      deleteProjectArtifactFile: vi.fn(),
      downloadProjectArtifactFile: vi.fn(),
    });

    await app.register(projectRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-1/files',
      headers: { authorization: 'Bearer test' },
      payload: {
        key: 'design_brief',
        description: 'Source brief for operators',
        file_name: 'brief.md',
        content_base64: Buffer.from('# Brief').toString('base64'),
        content_type: 'text/markdown',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(uploadProjectArtifactFile).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'project-1',
      expect.objectContaining({
        key: 'design_brief',
        description: 'Source brief for operators',
        fileName: 'brief.md',
      }),
    );
  });

  it('uploads multiple project-owned artifact files in one request and defaults keys from filenames', async () => {
    const { projectRoutes } = await import('../../src/api/routes/projects.routes.js');

    const uploadProjectArtifactFiles = vi.fn().mockResolvedValue([
      {
        id: 'file-1',
        project_id: 'project-1',
        key: 'brief-md',
        description: null,
        file_name: 'brief.md',
        content_type: 'text/markdown',
        size_bytes: 128,
        created_at: '2026-03-14T18:00:00.000Z',
        download_url: '/api/v1/projects/project-1/files/file-1/content',
      },
      {
        id: 'file-2',
        project_id: 'project-1',
        key: 'diagram-png',
        description: 'Architecture diagram',
        file_name: 'diagram.png',
        content_type: 'image/png',
        size_bytes: 2048,
        created_at: '2026-03-14T18:00:00.000Z',
        download_url: '/api/v1/projects/project-1/files/file-2/content',
      },
    ]);

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', {
      ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000,
      PROJECT_ARTIFACT_MAX_UPLOAD_FILES: 10,
      PROJECT_ARTIFACT_MAX_UPLOAD_BYTES: 10_485_760,
    });
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
      uploadProjectArtifactFiles,
      deleteProjectArtifactFile: vi.fn(),
      downloadProjectArtifactFile: vi.fn(),
    });

    await app.register(projectRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-1/files/batch',
      headers: { authorization: 'Bearer test' },
      payload: {
        files: [
          {
            file_name: 'brief.md',
            content_base64: Buffer.from('# Brief').toString('base64'),
            content_type: 'text/markdown',
          },
          {
            file_name: 'diagram.png',
            description: 'Architecture diagram',
            content_base64: Buffer.from('png').toString('base64'),
            content_type: 'image/png',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(uploadProjectArtifactFiles).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'project-1',
      [
        expect.objectContaining({
          key: 'brief-md',
          fileName: 'brief.md',
          description: undefined,
        }),
        expect.objectContaining({
          key: 'diagram-png',
          fileName: 'diagram.png',
          description: 'Architecture diagram',
        }),
      ],
    );
  });
});
