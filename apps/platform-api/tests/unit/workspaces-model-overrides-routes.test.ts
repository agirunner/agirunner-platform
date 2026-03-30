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

describe('workspace model override routes', () => {
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

  it('keeps silently ignoring retired workspace settings.model_overrides on create', async () => {
    const { workspaceRoutes } = await import('../../src/api/routes/workspaces.routes.js');
    const createWorkspace = vi.fn().mockResolvedValue({ id: 'workspace-1' });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { ARTIFACT_PREVIEW_MAX_BYTES: 1_000_000 });
    app.decorate('pgPool', {});
    app.decorate('eventService', {});
    app.decorate('workflowService', { getWorkspaceTimeline: vi.fn() });
    app.decorate('workspaceService', {
      createWorkspace,
      getWorkspace: vi.fn(),
      updateWorkspace: vi.fn(),
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
      setGitWebhookConfig: vi.fn(),
      deleteWorkspace: vi.fn(),
      listWorkspaces: vi.fn(),
      getWorkspaceDeleteImpact: vi.fn(),
      verifyWorkspaceGitAccess: vi.fn(),
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
          model_overrides: {
            developer: {
              provider: '',
              model: 'gpt-5',
            },
          },
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(createWorkspace).toHaveBeenCalled();
  });

  it('does not expose retired workspace model override routes', async () => {
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
      updateWorkspace: vi.fn(),
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
      setGitWebhookConfig: vi.fn(),
      deleteWorkspace: vi.fn(),
      listWorkspaces: vi.fn(),
      getWorkspaceDeleteImpact: vi.fn(),
      verifyWorkspaceGitAccess: vi.fn(),
    });
    app.decorate('workspaceArtifactFileService', {
      listWorkspaceArtifactFiles: vi.fn(),
      uploadWorkspaceArtifactFile: vi.fn(),
      uploadWorkspaceArtifactFiles: vi.fn(),
      deleteWorkspaceArtifactFile: vi.fn(),
      downloadWorkspaceArtifactFile: vi.fn(),
    });

    await app.register(workspaceRoutes);

    const [plainResponse, resolvedResponse] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/api/v1/workspaces/workspace-1/model-overrides',
        headers: { authorization: 'Bearer test' },
      }),
      app.inject({
        method: 'GET',
        url: '/api/v1/workspaces/workspace-1/model-overrides/resolved?roles=developer',
        headers: { authorization: 'Bearer test' },
      }),
    ]);

    expect(plainResponse.statusCode).toBe(404);
    expect(resolvedResponse.statusCode).toBe(404);
  });
});
