import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearSession, readSession, writeSession } from '../../lib/session.js';
import {
  requestWorkflowOperationsStreamResponse,
  shouldRetryWorkflowOperationsStream,
} from './workflows-realtime.js';

function mockBrowserStorage() {
  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, string>();
  vi.stubGlobal('localStorage', createStorage(localStore));
  vi.stubGlobal('sessionStorage', createStorage(sessionStore));
}

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

describe('requestWorkflowOperationsStreamResponse', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockBrowserStorage();
    clearSession();
    vi.stubGlobal('document', {
      cookie: 'agirunner_csrf_token=csrf-token-1',
    });
  });

  it('refreshes the browser session and retries the stream after a 401 response', async () => {
    writeSession({
      accessToken: 'expired-token',
      tenantId: 'tenant-1',
      persistentSession: true,
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { token: 'fresh-token' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('event: message\ndata: {"ok":true}\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );

    const response = await requestWorkflowOperationsStreamResponse({
      path: '/api/v1/operations/workflows/stream?mode=live',
      fetcher: fetchMock,
      signal: new AbortController().signal,
    });

    expect(response?.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v1/operations/workflows/stream?mode=live',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'text/event-stream',
          authorization: 'Bearer expired-token',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v1/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-csrf-token': 'csrf-token-1',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v1/operations/workflows/stream?mode=live',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer fresh-token',
        }),
      }),
    );
    expect(readSession()?.accessToken).toBe('fresh-token');
  });

  it('clears the session when the stream cannot refresh after a 401', async () => {
    writeSession({
      accessToken: 'expired-token',
      tenantId: 'tenant-1',
      persistentSession: true,
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));

    const response = await requestWorkflowOperationsStreamResponse({
      path: '/api/v1/operations/workflows/stream?mode=live',
      fetcher: fetchMock,
      signal: new AbortController().signal,
    });

    expect(response).toBeNull();
    expect(readSession()).toBeNull();
  });
});

describe('shouldRetryWorkflowOperationsStream', () => {
  it('treats deleted workflow workspace streams as terminal when the backend returns 404', () => {
    expect(
      shouldRetryWorkflowOperationsStream(
        '/api/v1/operations/workflows/workflow-1/stream?tab_scope=selected_work_item',
        404,
      ),
    ).toBe(false);
  });

  it('keeps retrying transient workflow stream failures', () => {
    expect(
      shouldRetryWorkflowOperationsStream(
        '/api/v1/operations/workflows/workflow-1/stream?tab_scope=selected_work_item',
        503,
      ),
    ).toBe(true);
  });

  it('does not change retry behavior for the shared rail stream endpoint', () => {
    expect(
      shouldRetryWorkflowOperationsStream(
        '/api/v1/operations/workflows/stream?mode=live',
        404,
      ),
    ).toBe(true);
  });
});
