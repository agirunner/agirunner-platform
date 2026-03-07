/**
 * Unit tests for SSE (Server-Sent Events) real-time update logic.
 *
 * FR-030a: All updates via streaming realtime transport.
 * FR-031:  Real-time activity feed.
 * FR-423a: Single connection for all real-time updates.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { matchesSubscription, processSseBuffer, resetEventTransportForTests, subscribeToEvents } from './sse.js';
import { clearSession, writeSession } from './session.js';

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

describe('FR-030a / FR-423a: SSE buffer processing', () => {
  it('processes a complete SSE message and invokes the event callback', () => {
    const handler = vi.fn();
    const remaining = processSseBuffer(
      'event: workflow.state_changed\ndata: {"workflowId":"abc"}\n\n',
      handler,
    );
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith('workflow.state_changed', { workflowId: 'abc' });
    expect(remaining).toBe('');
  });

  it('dispatches multiple event types from one buffered stream', () => {
    const handler = vi.fn();
    const input = [
      'event: workflow.created\ndata: {"id":"p1"}\n\n',
      'event: task.state_changed\ndata: {"taskId":"t1"}\n\n',
      'event: worker.heartbeat\ndata: {"workerId":"w1"}\n\n',
    ].join('');
    processSseBuffer(input, handler);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('buffers partial messages and returns the incomplete tail', () => {
    const handler = vi.fn();
    const partial = 'event: task.started\ndata: {"taskId":"t2"}';
    const remaining = processSseBuffer(partial, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(remaining).toBe(partial);
  });

  it('ignores malformed JSON payloads', () => {
    const handler = vi.fn();
    processSseBuffer('event: bad\ndata: {not json}\n\n', handler);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('event subscription matching', () => {
  it('matches when event-type prefix and entity type align', () => {
    const result = matchesSubscription(
      'worker.heartbeat',
      { entity_type: 'worker', entity_id: 'worker-1' },
      { eventTypePrefixes: ['worker.'], entityTypes: ['worker'] },
    );
    expect(result).toBe(true);
  });

  it('rejects when configured entity type does not match payload', () => {
    const result = matchesSubscription(
      'worker.heartbeat',
      { entity_type: 'agent', entity_id: 'agent-1' },
      { entityTypes: ['worker'] },
    );
    expect(result).toBe(false);
  });
});

describe('FR-031 / FR-423a: shared subscribeToEvents behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockLocalStorage();
    clearSession();
    resetEventTransportForTests();
  });

  it('returns a teardown function that aborts the shared stream', async () => {
    let abortSignal: AbortSignal | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
        abortSignal = opts.signal as AbortSignal;
        return Promise.reject(new Error('network down'));
      }),
    );

    writeSession({ accessToken: 'test-token', tenantId: 'tenant-1' });

    const unsubscribe = subscribeToEvents(vi.fn());
    unsubscribe();

    expect(abortSignal?.aborted).toBe(true);
  });

  it('uses one underlying fetch stream for multiple subscribers (singleton channel)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    writeSession({ accessToken: 'test-token', tenantId: 'tenant-1' });

    const unsubscribeOne = subscribeToEvents(vi.fn());
    const unsubscribeTwo = subscribeToEvents(vi.fn());

    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/events/stream',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      }),
    );

    unsubscribeOne();
    unsubscribeTwo();
  });

  it('does not start stream calls when no session is active', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('no network')) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const unsubscribe = subscribeToEvents(vi.fn());
    unsubscribe();

    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers websocket transport and subscribes after authentication', async () => {
    const sent: string[] = [];
    class MockWebSocket {
      static CLOSED = 3;
      static CLOSING = 2;
      static OPEN = 1;
      readyState = MockWebSocket.OPEN;
      private handlers = new Map<string, Array<(event?: { data: string }) => void>>();

      constructor(_url: string) {
        queueMicrotask(() => {
          this.emit('open');
        });
      }

      addEventListener(type: string, handler: (event?: { data: string }) => void) {
        this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
      }

      send(message: string) {
        sent.push(message);
        const parsed = JSON.parse(message) as { action?: string };
        if (parsed.action === 'authenticate') {
          this.emit('message', { data: JSON.stringify({ type: 'authenticated' }) });
        }
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.emit('close');
      }

      private emit(type: string, event?: { data: string }) {
        for (const handler of this.handlers.get(type) ?? []) {
          handler(event);
        }
      }
    }

    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal('window', { WebSocket: MockWebSocket });
    const fetchMock = vi.fn().mockRejectedValue(new Error('unused')) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    writeSession({ accessToken: 'test-token', tenantId: 'tenant-1' });

    const unsubscribe = subscribeToEvents(vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    unsubscribe();

    expect(sent).toContain(JSON.stringify({ action: 'authenticate', token: 'test-token' }));
    expect(sent).toContain(JSON.stringify({ action: 'subscribe', filters: {} }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
