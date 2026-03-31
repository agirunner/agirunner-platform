import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardApi } from './api.js';
import { resetDashboardApiTestEnvironment } from './dashboard-api/create-dashboard-api.test-support.js';
import { readSession, writeSession } from './session.js';

describe('dashboard api auth/session behavior', () => {
  beforeEach(() => {
    resetDashboardApiTestEnvironment();
  });

  it('routes workflow-linked escalation resolution through the workflow work-item operator flow', async () => {
    writeSession({ accessToken: 'token-1', tenantId: 'tenant-1' });

    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { id: 'task-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      baseUrl: 'http://platform.test',
      client: client as never,
      fetcher,
    });

    await api.resolveTaskEscalation(
      'task-1',
      { instructions: 'Resume with captured operator guidance.' },
      { workflowId: 'workflow-1', workItemId: 'wi-1' },
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'http://platform.test/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/resolve-escalation',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('keeps standalone escalation resolution on the raw task endpoint', async () => {
    writeSession({ accessToken: 'token-1', tenantId: 'tenant-1' });

    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { id: 'task-standalone-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      baseUrl: 'http://platform.test',
      client: client as never,
      fetcher,
    });

    await api.resolveTaskEscalation('task-standalone-1', {
      instructions: 'Continue using the standalone task flow.',
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'http://platform.test/api/v1/tasks/task-standalone-1/resolve-escalation',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('refreshes token and retries request when access token is expired', async () => {
    writeSession({ accessToken: 'expired-token', tenantId: 'tenant-1' });

    const listWorkflows = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 401: token expired'))
      .mockResolvedValueOnce({
        data: [],
        pagination: { page: 1, per_page: 50, total: 0, total_pages: 1 },
      });

    const client = {
      refreshSession: vi.fn().mockResolvedValue({ token: 'fresh-token' }),
      setAccessToken: vi.fn(),
      listWorkflows,
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });

    await api.listWorkflows();

    expect(client.refreshSession).toHaveBeenCalledTimes(1);
    expect(client.setAccessToken).toHaveBeenCalledWith('fresh-token');
    expect(listWorkflows).toHaveBeenCalledTimes(2);
    expect(readSession()).toEqual({
      accessToken: 'fresh-token',
      tenantId: 'tenant-1',
      persistentSession: false,
    });
  });

  it('requests mission control live, recent, history, and workflow workspace read models from the platform api', async () => {
    writeSession({ accessToken: 'mc-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi.mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              version: {
                generatedAt: '2026-03-27T18:00:00.000Z',
                latestEventId: 10,
                token: 'live-token',
              },
              sections: [],
              attentionItems: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              version: {
                generatedAt: '2026-03-27T18:01:00.000Z',
                latestEventId: 11,
                token: 'recent-token',
              },
              packets: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              version: {
                generatedAt: '2026-03-27T18:02:00.000Z',
                latestEventId: 12,
                token: 'history-token',
              },
              packets: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              version: {
                generatedAt: '2026-03-27T18:03:00.000Z',
                latestEventId: 13,
                token: 'workspace-token',
              },
              workflow: null,
              overview: null,
              board: null,
              outputs: {
                deliverables: [],
                feed: [],
              },
              steering: {
                availableActions: [],
                interventionHistory: [],
              },
              history: {
                packets: [],
              },
            },
          }),
          { status: 200 },
        ),
      );

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.getMissionControlLive({ page: 2, perPage: 25 });
    await api.getMissionControlRecent({ limit: 15 });
    await api.getMissionControlHistory({ workflowId: 'workflow-1', limit: 20 });
    await api.getMissionControlWorkflowWorkspace('workflow-1', {
      historyLimit: 12,
      outputLimit: 4,
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v1/operations/workflows?mode=live&page=2&per_page=25',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer mc-token',
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v1/operations/workflows?mode=recent&limit=15',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v1/operations/workflows?mode=history&workflow_id=workflow-1&limit=20',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v1/operations/workflows/workflow-1/workspace?history_limit=12&output_limit=4',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
  });

  it('clears session and redirects to login when refresh token is expired', async () => {
    writeSession({ accessToken: 'expired-token', tenantId: 'tenant-1' });

    const locationAssign = vi.fn();
    vi.stubGlobal('window', {
      location: {
        assign: locationAssign,
      },
    });

    const client = {
      refreshSession: vi.fn().mockRejectedValue(new Error('HTTP 401: refresh expired')),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn().mockRejectedValue(new Error('HTTP 401: token expired')),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });

    await expect(api.listWorkflows()).rejects.toThrow('HTTP 401: refresh expired');
    expect(readSession()).toBeNull();
    expect(locationAssign).toHaveBeenCalledWith('/login');
  });

  it('persists tenant bootstrap in localStorage and keeps the access token session-scoped by default', async () => {
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi
        .fn()
        .mockResolvedValue({ token: 'ephemeral-token', tenant_id: 'tenant-1' }),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });
    await api.login('ar_admin_test_key');

    expect(readSession()).toEqual({
      accessToken: 'ephemeral-token',
      tenantId: 'tenant-1',
      persistentSession: true,
    });
    expect(sessionStorage.getItem('agirunner.tenantId')).toBeNull();
    expect(localStorage.getItem('agirunner.tenantId')).toBe('tenant-1');
    expect(localStorage.getItem('agirunner.accessToken')).toBeNull();
    expect(sessionStorage.getItem('agirunner.accessToken')).toBe('ephemeral-token');
  });

  it('keeps tenant bootstrap in sessionStorage when persistent login is disabled', async () => {
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi
        .fn()
        .mockResolvedValue({ token: 'ephemeral-token', tenant_id: 'tenant-1' }),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });
    await api.login('ar_admin_test_key', false);

    expect(readSession()).toEqual({
      accessToken: 'ephemeral-token',
      tenantId: 'tenant-1',
      persistentSession: false,
    });
    expect(sessionStorage.getItem('agirunner.tenantId')).toBe('tenant-1');
    expect(localStorage.getItem('agirunner.tenantId')).toBeNull();
    expect(localStorage.getItem('agirunner.accessToken')).toBeNull();
    expect(sessionStorage.getItem('agirunner.accessToken')).toBe('ephemeral-token');
  });

  it('calls server-side logout before clearing the local session', async () => {
    writeSession({ accessToken: 'logout-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { logged_out: true } }), { status: 200 }),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    await api.logout();

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/auth/logout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
    expect(readSession()).toBeNull();
  });
});
