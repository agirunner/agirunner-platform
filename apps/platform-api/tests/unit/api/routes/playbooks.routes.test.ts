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
}));

describe('playbook routes', () => {
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

  it('patches a playbook through the admin route', async () => {
    const { playbookRoutes } = await import('../../src/api/routes/playbooks.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('playbookService', {
      createPlaybook: vi.fn(),
      listPlaybooks: vi.fn(),
      getPlaybook: vi.fn(),
      getPlaybookDeleteImpact: vi.fn(),
      updatePlaybook: vi.fn().mockResolvedValue({ id: 'playbook-2', version: 2 }),
      replacePlaybook: vi.fn(),
      setPlaybookArchived: vi.fn(),
      deletePlaybook: vi.fn(),
      deletePlaybookPermanently: vi.fn(),
    });

    await app.register(playbookRoutes);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/playbooks/playbook-1',
      headers: { authorization: 'Bearer test' },
      payload: { description: 'Updated' },
    });

    expect(response.statusCode).toBe(200);
    expect(app.playbookService.updatePlaybook).toHaveBeenCalledWith('tenant-1', 'playbook-1', {
      description: 'Updated',
    });
    expect(response.json().data).toEqual({ id: 'playbook-2', version: 2 });
  });

  it('rejects empty patch bodies', async () => {
    const { playbookRoutes } = await import('../../src/api/routes/playbooks.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('playbookService', {
      createPlaybook: vi.fn(),
      listPlaybooks: vi.fn(),
      getPlaybook: vi.fn(),
      getPlaybookDeleteImpact: vi.fn(),
      updatePlaybook: vi.fn(),
      replacePlaybook: vi.fn(),
      setPlaybookArchived: vi.fn(),
      deletePlaybook: vi.fn(),
      deletePlaybookPermanently: vi.fn(),
    });

    await app.register(playbookRoutes);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/playbooks/playbook-1',
      headers: { authorization: 'Bearer test' },
      payload: {},
    });

    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('At least one field is required');
  });

  it('replaces a playbook through the admin route', async () => {
    const { playbookRoutes } = await import('../../src/api/routes/playbooks.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('playbookService', {
      createPlaybook: vi.fn(),
      listPlaybooks: vi.fn(),
      getPlaybook: vi.fn(),
      getPlaybookDeleteImpact: vi.fn(),
      updatePlaybook: vi.fn(),
      replacePlaybook: vi.fn().mockResolvedValue({ id: 'playbook-2', version: 2 }),
      setPlaybookArchived: vi.fn(),
      deletePlaybook: vi.fn(),
      deletePlaybookPermanently: vi.fn(),
    });

    await app.register(playbookRoutes);

    const payload = {
      name: 'Release Flow',
      outcome: 'Ship',
      definition: {
        board: { columns: [{ id: 'todo', label: 'To Do' }] },
      },
    };

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/playbooks/playbook-1',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(app.playbookService.replacePlaybook).toHaveBeenCalledWith(
      'tenant-1',
      'playbook-1',
      payload,
    );
    expect(response.json().data).toEqual({ id: 'playbook-2', version: 2 });
  });

  it('archives or restores a playbook through the admin route', async () => {
    const { playbookRoutes } = await import('../../src/api/routes/playbooks.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('playbookService', {
      createPlaybook: vi.fn(),
      listPlaybooks: vi.fn(),
      getPlaybook: vi.fn(),
      getPlaybookDeleteImpact: vi.fn(),
      updatePlaybook: vi.fn(),
      replacePlaybook: vi.fn(),
      setPlaybookArchived: vi.fn().mockResolvedValue({ id: 'playbook-1', is_active: false }),
      deletePlaybook: vi.fn(),
      deletePlaybookPermanently: vi.fn(),
    });

    await app.register(playbookRoutes);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/playbooks/playbook-1/archive',
      headers: { authorization: 'Bearer test' },
      payload: { archived: true },
    });

    expect(response.statusCode).toBe(200);
    expect(app.playbookService.setPlaybookArchived).toHaveBeenCalledWith(
      'tenant-1',
      'playbook-1',
      true,
    );
    expect(response.json().data).toEqual({ id: 'playbook-1', is_active: false });
  });

  it('deletes a playbook through the admin route', async () => {
    const { playbookRoutes } = await import('../../src/api/routes/playbooks.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('playbookService', {
      createPlaybook: vi.fn(),
      listPlaybooks: vi.fn(),
      getPlaybook: vi.fn(),
      getPlaybookDeleteImpact: vi.fn(),
      updatePlaybook: vi.fn(),
      replacePlaybook: vi.fn(),
      setPlaybookArchived: vi.fn(),
      deletePlaybook: vi.fn().mockResolvedValue({ id: 'playbook-1', deleted: true }),
      deletePlaybookPermanently: vi.fn(),
    });

    await app.register(playbookRoutes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/playbooks/playbook-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(app.playbookService.deletePlaybook).toHaveBeenCalledWith('tenant-1', 'playbook-1');
    expect(response.json().data).toEqual({ id: 'playbook-1', deleted: true });
  });

  it('returns delete impact summaries for a playbook revision and family', async () => {
    const { playbookRoutes } = await import('../../src/api/routes/playbooks.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('playbookService', {
      createPlaybook: vi.fn(),
      listPlaybooks: vi.fn(),
      getPlaybook: vi.fn(),
      getPlaybookDeleteImpact: vi.fn().mockResolvedValue({
        revision: { workflows: 2, active_workflows: 1, tasks: 5, active_tasks: 2, work_items: 3 },
        family: { revisions: 4, workflows: 7, active_workflows: 2, tasks: 16, active_tasks: 4, work_items: 9 },
      }),
      updatePlaybook: vi.fn(),
      replacePlaybook: vi.fn(),
      setPlaybookArchived: vi.fn(),
      deletePlaybook: vi.fn(),
      deletePlaybookPermanently: vi.fn(),
    });

    await app.register(playbookRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/playbooks/playbook-1/delete-impact',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(app.playbookService.getPlaybookDeleteImpact).toHaveBeenCalledWith('tenant-1', 'playbook-1');
    expect(response.json().data).toEqual({
      revision: { workflows: 2, active_workflows: 1, tasks: 5, active_tasks: 2, work_items: 3 },
      family: { revisions: 4, workflows: 7, active_workflows: 2, tasks: 16, active_tasks: 4, work_items: 9 },
    });
  });

  it('deletes a playbook family permanently through the admin route', async () => {
    const { playbookRoutes } = await import('../../src/api/routes/playbooks.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('playbookService', {
      createPlaybook: vi.fn(),
      listPlaybooks: vi.fn(),
      getPlaybook: vi.fn(),
      getPlaybookDeleteImpact: vi.fn(),
      updatePlaybook: vi.fn(),
      replacePlaybook: vi.fn(),
      setPlaybookArchived: vi.fn(),
      deletePlaybook: vi.fn(),
      deletePlaybookPermanently: vi.fn().mockResolvedValue({
        id: 'playbook-1',
        deleted: true,
        deleted_revision_count: 4,
        deleted_workflow_count: 7,
      }),
    });

    await app.register(playbookRoutes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/playbooks/playbook-1/permanent',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(app.playbookService.deletePlaybookPermanently).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'playbook-1',
    );
    expect(response.json().data).toEqual({
      id: 'playbook-1',
      deleted: true,
      deleted_revision_count: 4,
      deleted_workflow_count: 7,
    });
  });
});
