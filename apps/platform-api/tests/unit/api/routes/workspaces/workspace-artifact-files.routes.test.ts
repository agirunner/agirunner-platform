import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
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

describe('workspace artifact file routes', () => {
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

  it('lists workspace-owned artifact files from a dedicated workspace route', async () => {
    const { workspaceRoutes } = await import('../../../../../src/api/routes/workspaces/workspaces.routes.js');

    const listWorkspaceArtifactFiles = vi.fn().mockResolvedValue([
      {
        id: 'file-1',
        workspace_id: 'workspace-1',
        key: 'design_brief',
        description: 'Source brief for operators',
        file_name: 'brief.md',
        content_type: 'text/markdown',
        size_bytes: 128,
        created_at: '2026-03-14T18:00:00.000Z',
        download_url: '/api/v1/workspaces/workspace-1/files/file-1/content',
      },
    ]);

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
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
      listWorkspaceArtifactFiles,
      uploadWorkspaceArtifactFile: vi.fn(),
      deleteWorkspaceArtifactFile: vi.fn(),
      downloadWorkspaceArtifactFile: vi.fn(),
    });

    await app.register(workspaceRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/workspace-1/files',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listWorkspaceArtifactFiles).toHaveBeenCalledWith('tenant-1', 'workspace-1');
    expect(response.json().data[0]).toEqual(
      expect.objectContaining({
        workspace_id: 'workspace-1',
        key: 'design_brief',
        file_name: 'brief.md',
      }),
    );
  });

  it('uploads workspace-owned artifact files without requiring workflow or task scope', async () => {
    const { workspaceRoutes } = await import('../../../../../src/api/routes/workspaces/workspaces.routes.js');

    const uploadWorkspaceArtifactFile = vi.fn().mockResolvedValue({
      id: 'file-1',
      workspace_id: 'workspace-1',
      key: 'design_brief',
      description: 'Source brief for operators',
      file_name: 'brief.md',
      content_type: 'text/markdown',
      size_bytes: 128,
      created_at: '2026-03-14T18:00:00.000Z',
      download_url: '/api/v1/workspaces/workspace-1/files/file-1/content',
    });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
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
      uploadWorkspaceArtifactFile,
      deleteWorkspaceArtifactFile: vi.fn(),
      downloadWorkspaceArtifactFile: vi.fn(),
    });

    await app.register(workspaceRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces/workspace-1/files',
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
    expect(uploadWorkspaceArtifactFile).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workspace-1',
      expect.objectContaining({
        key: 'design_brief',
        description: 'Source brief for operators',
        fileName: 'brief.md',
      }),
    );
  });

  it('uploads multiple workspace-owned artifact files in one request and defaults keys from filenames', async () => {
    const { workspaceRoutes } = await import('../../../../../src/api/routes/workspaces/workspaces.routes.js');

    const uploadWorkspaceArtifactFiles = vi.fn().mockResolvedValue([
      {
        id: 'file-1',
        workspace_id: 'workspace-1',
        key: 'brief-md',
        description: null,
        file_name: 'brief.md',
        content_type: 'text/markdown',
        size_bytes: 128,
        created_at: '2026-03-14T18:00:00.000Z',
        download_url: '/api/v1/workspaces/workspace-1/files/file-1/content',
      },
      {
        id: 'file-2',
        workspace_id: 'workspace-1',
        key: 'diagram-png',
        description: 'Architecture diagram',
        file_name: 'diagram.png',
        content_type: 'image/png',
        size_bytes: 2048,
        created_at: '2026-03-14T18:00:00.000Z',
        download_url: '/api/v1/workspaces/workspace-1/files/file-2/content',
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
      uploadWorkspaceArtifactFiles,
      deleteWorkspaceArtifactFile: vi.fn(),
      downloadWorkspaceArtifactFile: vi.fn(),
    });

    await app.register(workspaceRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces/workspace-1/files/batch',
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
    expect(uploadWorkspaceArtifactFiles).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workspace-1',
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
