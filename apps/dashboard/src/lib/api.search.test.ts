import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardApi } from './api.js';
import { resetDashboardApiTestEnvironment } from './dashboard-api/create-dashboard-api.test-support.js';
import { writeSession } from './session.js';

describe('dashboard global search', () => {
  beforeEach(() => {
    resetDashboardApiTestEnvironment();
  });

  it('search() merges matches from all dashboard resources', async () => {
    writeSession({ accessToken: 'token', tenantId: 'tenant-1' });

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      exchangeApiKey: vi.fn(),
      listWorkflows: vi.fn().mockResolvedValue({
        data: [{ id: 'workflow-1', name: 'Test Workflow', state: 'running' }],
      }),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi
        .fn()
        .mockResolvedValue({ data: [{ id: 'task-1', title: 'Test task', state: 'ready' }] }),
      getTask: vi.fn(),
      listWorkers: vi
        .fn()
        .mockResolvedValue([{ id: 'worker-1', name: 'Test worker', status: 'online' }]),
      listAgents: vi
        .fn()
        .mockResolvedValue([{ id: 'agent-1', name: 'Test agent', status: 'idle' }]),
      listWorkspaces: vi
        .fn()
        .mockResolvedValue({ data: [{ id: 'workspace-1', name: 'Test workspace' }] }),
      listPlaybooks: vi
        .fn()
        .mockResolvedValue({ data: [{ id: 'playbook-1', name: 'Test playbook' }] }),
    };
    const api = createDashboardApi({
      client: client as never,
      baseUrl: 'http://localhost:8080',
    });
    const results = await api.search('test');

    expect(results).toHaveLength(5);
    expect(client.listWorkflows).toHaveBeenCalledWith({ per_page: 50 });
    expect(client.listTasks).toHaveBeenCalledWith({ per_page: 50 });
    expect(client.listWorkspaces).toHaveBeenCalledWith({ per_page: 50 });
    expect(client.listPlaybooks).toHaveBeenCalled();
  });

  it('deletes a workspace through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 }),
      ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.deleteWorkspace('workspace-42');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-42',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });

  it('loads workspace delete impact through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            workflows: 3,
            active_workflows: 1,
            tasks: 8,
            active_tasks: 2,
            work_items: 4,
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await expect(api.getWorkspaceDeleteImpact('workspace-42')).resolves.toEqual({
      workflows: 3,
      active_workflows: 1,
      tasks: 8,
      active_tasks: 2,
      work_items: 4,
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-42/delete-impact',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });

  it('deletes a workspace with cascade enabled through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { deleted: true } }), { status: 200 }),
      ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.deleteWorkspace('workspace-42', { cascade: true });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-42?cascade=true',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });

  it('loads playbook delete impact through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            revision: {
              workflows: 1,
              active_workflows: 0,
              tasks: 2,
              active_tasks: 0,
              work_items: 1,
            },
            family: {
              revisions: 4,
              workflows: 7,
              active_workflows: 2,
              tasks: 18,
              active_tasks: 4,
              work_items: 9,
            },
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await expect(api.getPlaybookDeleteImpact('playbook-42')).resolves.toEqual({
      revision: {
        workflows: 1,
        active_workflows: 0,
        tasks: 2,
        active_tasks: 0,
        work_items: 1,
      },
      family: {
        revisions: 4,
        workflows: 7,
        active_workflows: 2,
        tasks: 18,
        active_tasks: 4,
        work_items: 9,
      },
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/playbooks/playbook-42/delete-impact',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });

  it('deletes a playbook family permanently through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { deleted: true } }), { status: 200 }),
      ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.deletePlaybookPermanently('playbook-42');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/playbooks/playbook-42/permanent',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });
});
