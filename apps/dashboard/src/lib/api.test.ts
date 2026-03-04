import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardApi } from './api.js';
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

  it('clears session when refresh token is expired', async () => {
    writeSession({ accessToken: 'expired-token', tenantId: 'tenant-1' });

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
  });

  it('persists access token across reload-style reads after login', async () => {
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      exchangeApiKey: vi.fn().mockResolvedValue({ token: 'persisted-token', tenant_id: 'tenant-1' }),
      getPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });
    await api.login('ab_admin_test_key');

    expect(readSession()).toEqual({ accessToken: 'persisted-token', tenantId: 'tenant-1' });
  });

  it('sends bearer token when loading metrics', async () => {
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
});
