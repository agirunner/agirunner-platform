import { describe, expect, it, vi } from 'vitest';

import { createDashboardApi } from './create-dashboard-api.js';
import { clearSession, writeSession } from '../auth/session.js';

describe('dashboard api workflow work-item lifecycle controls', () => {
  it('posts work-item pause/resume/cancel lifecycle actions with generated request ids', async () => {
    const localStore = new Map<string, string>();
    const sessionStore = new Map<string, string>();
    vi.stubGlobal('localStorage', createStorage(localStore));
    vi.stubGlobal('sessionStorage', createStorage(sessionStore));
    writeSession({ accessToken: 'workflow-token', tenantId: 'tenant-1' });
    vi.stubGlobal('crypto', {
      randomUUID: vi
        .fn()
        .mockReturnValueOnce('pause-request-1')
        .mockReturnValueOnce('resume-request-1')
        .mockReturnValueOnce('cancel-request-1'),
    });

    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ data: { id: 'wi-1' } }), { status: 200 }),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.pauseWorkflowWorkItem('workflow-1', 'wi-1');
    await api.resumeWorkflowWorkItem('workflow-1', 'wi-1');
    await api.cancelWorkflowWorkItem('workflow-1', 'wi-1');

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v1/workflows/workflow-1/work-items/wi-1/pause',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v1/workflows/workflow-1/work-items/wi-1/resume',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v1/workflows/workflow-1/work-items/wi-1/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}'))).toEqual({
      request_id: 'pause-request-1',
    });
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[1]?.[1]?.body ?? '{}'))).toEqual({
      request_id: 'resume-request-1',
    });
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[2]?.[1]?.body ?? '{}'))).toEqual({
      request_id: 'cancel-request-1',
    });

    clearSession();
  });
});

function createStorage(store: Map<string, string>) {
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}
