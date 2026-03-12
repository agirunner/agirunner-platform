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
      updatePlaybook: vi.fn().mockResolvedValue({ id: 'playbook-2', version: 2 }),
      replacePlaybook: vi.fn(),
      setPlaybookArchived: vi.fn(),
      deletePlaybook: vi.fn(),
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
      updatePlaybook: vi.fn(),
      replacePlaybook: vi.fn(),
      setPlaybookArchived: vi.fn(),
      deletePlaybook: vi.fn(),
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
      updatePlaybook: vi.fn(),
      replacePlaybook: vi.fn().mockResolvedValue({ id: 'playbook-2', version: 2 }),
      setPlaybookArchived: vi.fn(),
      deletePlaybook: vi.fn(),
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
      updatePlaybook: vi.fn(),
      replacePlaybook: vi.fn(),
      setPlaybookArchived: vi.fn().mockResolvedValue({ id: 'playbook-1', is_active: false }),
      deletePlaybook: vi.fn(),
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
      updatePlaybook: vi.fn(),
      replacePlaybook: vi.fn(),
      setPlaybookArchived: vi.fn(),
      deletePlaybook: vi.fn().mockResolvedValue({ id: 'playbook-1', deleted: true }),
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
});
