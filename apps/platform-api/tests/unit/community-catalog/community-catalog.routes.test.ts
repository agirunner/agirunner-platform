import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../src/errors/error-handler.js';

vi.mock('../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      userId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
}));

describe('community catalog routes', () => {
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

  it('lists catalog playbooks', async () => {
    const { communityCatalogRoutes } = await import('../../../src/api/routes/community-catalog/routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('communityCatalogSourceService', {
      listPlaybooks: vi.fn().mockResolvedValue([
        { id: 'bug-fix', name: 'Bug Fix', author: 'agirunner', version: '1.0.0' },
      ]),
      getPlaybookDetail: vi.fn(),
    });
    app.decorate('communityCatalogPreviewService', {
      previewImport: vi.fn(),
    });
    app.decorate('communityCatalogImportService', {
      importPlaybooks: vi.fn(),
    });
    app.decorate('communityCatalogOriginService', {
      getPlaybookOrigin: vi.fn(),
    });

    await app.register(communityCatalogRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/community-catalog/playbooks',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [{ id: 'bug-fix', name: 'Bug Fix', author: 'agirunner', version: '1.0.0' }],
    });
  });

  it('previews batch import selections', async () => {
    const { communityCatalogRoutes } = await import('../../../src/api/routes/community-catalog/routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('communityCatalogSourceService', {
      listPlaybooks: vi.fn(),
      getPlaybookDetail: vi.fn(),
    });
    app.decorate('communityCatalogPreviewService', {
      previewImport: vi.fn().mockResolvedValue({ selectedPlaybooks: [], conflicts: [] }),
    });
    app.decorate('communityCatalogImportService', {
      importPlaybooks: vi.fn(),
    });
    app.decorate('communityCatalogOriginService', {
      getPlaybookOrigin: vi.fn(),
    });

    await app.register(communityCatalogRoutes);

    const payload = { playbook_ids: ['bug-fix', 'hotfix'] };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/community-catalog/import-preview',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(app.communityCatalogPreviewService.previewImport).toHaveBeenCalledWith('tenant-1', {
      playbookIds: ['bug-fix', 'hotfix'],
    });
  });

  it('returns playbook origin metadata for imported playbooks', async () => {
    const { communityCatalogRoutes } = await import('../../../src/api/routes/community-catalog/routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('communityCatalogSourceService', {
      listPlaybooks: vi.fn(),
      getPlaybookDetail: vi.fn(),
    });
    app.decorate('communityCatalogPreviewService', {
      previewImport: vi.fn(),
    });
    app.decorate('communityCatalogImportService', {
      importPlaybooks: vi.fn(),
    });
    app.decorate('communityCatalogOriginService', {
      getPlaybookOrigin: vi.fn().mockResolvedValue({
        catalogId: 'bug-fix',
        catalogName: 'Bug Fix',
        catalogVersion: '1.0.0',
      }),
    });

    await app.register(communityCatalogRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/community-catalog/imported-playbooks/local-playbook-1/origin',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        catalogId: 'bug-fix',
        catalogName: 'Bug Fix',
        catalogVersion: '1.0.0',
      },
    });
  });
});
