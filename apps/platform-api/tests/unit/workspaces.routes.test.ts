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

describe('workspace routes', () => {
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

  it('rejects legacy settings.model_override on workspace create', async () => {
    const { workspaceRoutes } = await import('../../src/api/routes/workspaces.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
    app.decorate('pgPool', {});
    app.decorate('eventService', {});
    app.decorate('workflowService', { getWorkspaceTimeline: vi.fn() });
    app.decorate('workspaceService', {
      createWorkspace: vi.fn(),
      getWorkspace: vi.fn(),
      getWorkspaceDeleteImpact: vi.fn(),
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

    await app.register(workspaceRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
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

  it('returns workspace list summaries from the list route unchanged', async () => {
    const { workspaceRoutes } = await import('../../src/api/routes/workspaces.routes.js');

    const listWorkspaces = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'workspace-1',
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
    app.decorate('workflowService', { getWorkspaceTimeline: vi.fn() });
    app.decorate('workspaceService', {
      createWorkspace: vi.fn(),
      getWorkspace: vi.fn(),
      getWorkspaceDeleteImpact: vi.fn(),
      updateWorkspace: vi.fn(),
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
      setGitWebhookConfig: vi.fn(),
      deleteWorkspace: vi.fn(),
      listWorkspaces,
    });
    app.decorate('workspaceArtifactFileService', {
      listWorkspaceArtifactFiles: vi.fn(),
      uploadWorkspaceArtifactFile: vi.fn(),
      uploadWorkspaceArtifactFiles: vi.fn(),
      deleteWorkspaceArtifactFile: vi.fn(),
      downloadWorkspaceArtifactFile: vi.fn(),
    });

    await app.register(workspaceRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces?per_page=50',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listWorkspaces).toHaveBeenCalledWith('tenant-1', {
      page: 1,
      per_page: 50,
      q: undefined,
      is_active: undefined,
    });
    expect(response.json()).toEqual({
      data: [
        {
          id: 'workspace-1',
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

  it('deletes workspace memory entries through the workspace admin routes', async () => {
    const { workspaceRoutes } = await import('../../src/api/routes/workspaces.routes.js');

    const removeWorkspaceMemory = vi.fn().mockResolvedValue({
      id: 'workspace-1',
      memory: {},
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
      getWorkspaceDeleteImpact: vi.fn(),
      updateWorkspace: vi.fn(),
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory,
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

    await app.register(workspaceRoutes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/workspaces/workspace-1/memory/operator_note',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(removeWorkspaceMemory).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workspace-1',
      'operator_note',
    );
  });

  it('returns a workspace delete impact summary', async () => {
    const { workspaceRoutes } = await import('../../src/api/routes/workspaces.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
    app.decorate('pgPool', {});
    app.decorate('eventService', {});
    app.decorate('workflowService', { getWorkspaceTimeline: vi.fn() });
    app.decorate('workspaceService', {
      createWorkspace: vi.fn(),
      getWorkspace: vi.fn(),
      getWorkspaceDeleteImpact: vi.fn().mockResolvedValue({
        workflows: 3,
        active_workflows: 1,
        tasks: 9,
        active_tasks: 2,
        work_items: 4,
      }),
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

    await app.register(workspaceRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/workspace-1/delete-impact',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(app.workspaceService.getWorkspaceDeleteImpact).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workspace-1',
    );
    expect(response.json().data).toEqual({
      workflows: 3,
      active_workflows: 1,
      tasks: 9,
      active_tasks: 2,
      work_items: 4,
    });
  });

  it('passes the cascade flag through workspace deletion', async () => {
    const { workspaceRoutes } = await import('../../src/api/routes/workspaces.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
    app.decorate('pgPool', {});
    app.decorate('eventService', {});
    app.decorate('workflowService', { getWorkspaceTimeline: vi.fn() });
    app.decorate('workspaceService', {
      createWorkspace: vi.fn(),
      getWorkspace: vi.fn(),
      getWorkspaceDeleteImpact: vi.fn(),
      updateWorkspace: vi.fn(),
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
      setGitWebhookConfig: vi.fn(),
      deleteWorkspace: vi.fn().mockResolvedValue({ id: 'workspace-1', deleted: true }),
      listWorkspaces: vi.fn(),
    });
    app.decorate('workspaceArtifactFileService', {
      listWorkspaceArtifactFiles: vi.fn(),
      uploadWorkspaceArtifactFile: vi.fn(),
      uploadWorkspaceArtifactFiles: vi.fn(),
      deleteWorkspaceArtifactFile: vi.fn(),
      downloadWorkspaceArtifactFile: vi.fn(),
    });

    await app.register(workspaceRoutes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/workspaces/workspace-1?cascade=true',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(app.workspaceService.deleteWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workspace-1',
      { cascade: true },
    );
    expect(response.json().data).toEqual({ id: 'workspace-1', deleted: true });
  });
});
