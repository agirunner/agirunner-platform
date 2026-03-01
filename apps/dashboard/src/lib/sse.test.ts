/**
 * Unit tests for SSE (Server-Sent Events) real-time update logic.
 *
 * FR-030a: All updates via WebSocket (SSE transport)
 * FR-031:  Real-time activity feed
 * FR-423a: Single connection for all real-time updates
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processSseBuffer, subscribeToEvents } from './sse.js';
import { clearSession, writeSession } from './session.js';

function mockLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FR-030a / FR-423a: SSE buffer processing (core of the real-time channel)
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-030a / FR-423a: SSE buffer processing', () => {
  // FR-030a: All updates via WebSocket (SSE)
  it('processes a complete SSE message and invokes the event callback', () => {
    const handler = vi.fn();
    const remaining = processSseBuffer(
      'event: pipeline.state_changed\ndata: {"pipelineId":"abc"}\n\n',
      handler,
    );
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith('pipeline.state_changed', { pipelineId: 'abc' });
    expect(remaining).toBe('');
  });

  // FR-423a: Single connection handles all real-time event types
  it('dispatches multiple event types from a single buffered stream', () => {
    const handler = vi.fn();
    const input = [
      'event: pipeline.created\ndata: {"id":"p1"}\n\n',
      'event: task.state_changed\ndata: {"taskId":"t1"}\n\n',
      'event: worker.heartbeat\ndata: {"workerId":"w1"}\n\n',
    ].join('');
    processSseBuffer(input, handler);
    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler.mock.calls[0]).toEqual(['pipeline.created', { id: 'p1' }]);
    expect(handler.mock.calls[1]).toEqual(['task.state_changed', { taskId: 't1' }]);
    expect(handler.mock.calls[2]).toEqual(['worker.heartbeat', { workerId: 'w1' }]);
  });

  it('defaults event type to "message" when no event field is present', () => {
    const handler = vi.fn();
    processSseBuffer('data: {"value":42}\n\n', handler);
    expect(handler).toHaveBeenCalledWith('message', { value: 42 });
  });

  it('buffers partial SSE messages and returns the incomplete tail', () => {
    const handler = vi.fn();
    const partial = 'event: task.started\ndata: {"taskId":"t2"}';
    const remaining = processSseBuffer(partial, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(remaining).toBe(partial);
  });

  it('handles a complete message followed by a partial message correctly', () => {
    const handler = vi.fn();
    const input = 'event: done\ndata: {"ok":true}\n\nevent: pending\ndata: {"partial":true}';
    const remaining = processSseBuffer(input, handler);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith('done', { ok: true });
    expect(remaining).toBe('event: pending\ndata: {"partial":true}');
  });

  it('silently ignores messages with malformed JSON payloads', () => {
    const handler = vi.fn();
    processSseBuffer('event: bad\ndata: {not json}\n\n', handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('skips messages with no data field', () => {
    const handler = vi.fn();
    processSseBuffer('event: ping\n\n', handler);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-031: Real-time activity feed (subscribeToEvents returns unsubscribe fn)
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-031: subscribeToEvents returns an unsubscribe function', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage();
    clearSession();
  });

  it('returns a callable teardown function immediately', () => {
    // Stub fetch so the async loop does not make real network calls
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')));
    const unsubscribe = subscribeToEvents(vi.fn());
    expect(typeof unsubscribe).toBe('function');
    unsubscribe(); // should abort without throwing
  });

  it('does not invoke the callback when no session is active', () => {
    // clearSession already called in beforeEach — no active session
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')));
    const callback = vi.fn();
    const unsubscribe = subscribeToEvents(callback);
    unsubscribe();
    expect(callback).not.toHaveBeenCalled();
  });

  it('aborts the SSE connection when the returned teardown is called', () => {
    let abortSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      abortSignal = opts.signal as AbortSignal;
      return Promise.reject(new Error('aborted'));
    }));
    writeSession({ accessToken: 'test-token', tenantId: 'tenant-1' });

    const unsubscribe = subscribeToEvents(vi.fn());
    unsubscribe();
    // After abort the signal should be marked aborted
    expect(abortSignal?.aborted).toBe(true);
  });
});
