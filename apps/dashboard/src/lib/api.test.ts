import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSearchResults, createDashboardApi } from './api.js';
import { clearSession, readSession, writeSession } from './session.js';

function mockLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
}

describe('dashboard api auth/session behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockLocalStorage();
    clearSession();
  });

  it('refreshes token and retries request when access token is expired', async () => {
    writeSession({ accessToken: 'expired-token', tenantId: 'tenant-1' });

    const listPipelines = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 401: token expired'))
      .mockResolvedValueOnce({ data: [], pagination: { page: 1, per_page: 50, total: 0, total_pages: 1 } });

    const client = {
      refreshSession: vi.fn().mockResolvedValue({ token: 'fresh-token' }),
      setAccessToken: vi.fn(),
      listPipelines,
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });

    await api.listPipelines();

    expect(client.refreshSession).toHaveBeenCalledTimes(1);
    expect(client.setAccessToken).toHaveBeenCalledWith('fresh-token');
    expect(listPipelines).toHaveBeenCalledTimes(2);
    expect(readSession()).toEqual({ accessToken: 'fresh-token', tenantId: 'tenant-1' });
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
      listPipelines: vi.fn().mockRejectedValue(new Error('HTTP 401: token expired')),
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });

    await expect(api.listPipelines()).rejects.toThrow('HTTP 401: refresh expired');
    expect(readSession()).toBeNull();
    expect(locationAssign).toHaveBeenCalledWith('/login');
  });

  it('persists tenant id but not access token after login', async () => {
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      exchangeApiKey: vi.fn().mockResolvedValue({ token: 'ephemeral-token', tenant_id: 'tenant-1' }),
      getPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });
    await api.login('ab_admin_test_key');

    expect(readSession()).toEqual({ accessToken: 'ephemeral-token', tenantId: 'tenant-1' });
    expect(localStorage.getItem('agentbaton.tenantId')).toBe('tenant-1');
    expect(localStorage.getItem('agentbaton.accessToken')).toBeNull();
  });

  it('sends bearer token when loading metrics if an in-memory access token exists', async () => {
    writeSession({ accessToken: 'metrics-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never, fetcher, baseUrl: 'http://localhost:8080' });
    const body = await api.getMetrics();

    expect(body).toBe('ok');
    const [, options] = vi.mocked(fetcher).mock.calls[0];
    const headers = options?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer metrics-token');
  });

  it('loads metrics using cookie-only auth when no in-memory access token exists', async () => {
    writeSession({ accessToken: null, tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never, fetcher, baseUrl: 'http://localhost:8080' });
    const body = await api.getMetrics();

    expect(body).toBe('ok');
    const [, options] = vi.mocked(fetcher).mock.calls[0];
    expect(options?.headers).toBeUndefined();
    expect(options?.credentials).toBe('include');
  });
});

describe('dashboard global search', () => {
  it('buildSearchResults creates task/pipeline/worker/agent route targets', () => {
    const results = buildSearchResults('build', {
      pipelines: [{ id: 'pipeline-1', name: 'Build Pipeline', state: 'running' }],
      tasks: [{ id: 'task-1', title: 'Build artifact', state: 'ready' }],
      workers: [{ id: 'worker-1', name: 'Builder worker', status: 'online' }],
      agents: [{ id: 'agent-1', name: 'Builder agent', status: 'idle' }],
    });

    expect(results.map((result) => result.type)).toEqual(['pipeline', 'task', 'worker', 'agent']);
    expect(results[0].href).toBe('/pipelines/pipeline-1');
    expect(results[1].href).toBe('/tasks/task-1');
    expect(results[2].href).toBe('/workers');
  });

  it('search() merges matches from all dashboard resources', async () => {
    writeSession({ accessToken: 'token', tenantId: 'tenant-1' });

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      exchangeApiKey: vi.fn(),
      listPipelines: vi.fn().mockResolvedValue({ data: [{ id: 'pipeline-1', name: 'Test Pipeline', state: 'running' }] }),
      getPipeline: vi.fn(),
      listTasks: vi.fn().mockResolvedValue({ data: [{ id: 'task-1', title: 'Test task', state: 'ready' }] }),
      getTask: vi.fn(),
      listWorkers: vi.fn().mockResolvedValue([{ id: 'worker-1', name: 'Test worker', status: 'online' }]),
      listAgents: vi.fn().mockResolvedValue([{ id: 'agent-1', name: 'Test agent', status: 'idle' }]),
    };

    const api = createDashboardApi({ client: client as never });
    const results = await api.search('test');

    expect(results).toHaveLength(4);
    expect(client.listPipelines).toHaveBeenCalledWith({ per_page: 50 });
    expect(client.listTasks).toHaveBeenCalledWith({ per_page: 50 });
  });
});
