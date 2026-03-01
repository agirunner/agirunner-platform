import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlatformRealtimeClient } from './realtime.js';

describe('PlatformRealtimeClient auth transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not include access token in SSE URL', async () => {
    const urlCalls: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"id":"evt-1"}\n\n'));
        controller.close();
      },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      urlCalls.push(String(input));
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);

    const client = new PlatformRealtimeClient({
      baseUrl: 'https://platform.example.com',
      eventsPath: '/api/v1/events',
      accessToken: 'secret-token',
    });

    const stop = client.connect(() => {});
    await Promise.resolve();
    stop();

    expect(urlCalls[0]).toBe('https://platform.example.com/api/v1/events');
    expect(urlCalls[0]).not.toContain('secret-token');
    expect(urlCalls[0]).not.toContain('access_token');
  });

  it('reconnects SSE stream after disconnect', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"id":"evt-1"}\n\n'));
              controller.close();
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"id":"evt-2"}\n\n'));
              controller.close();
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);

    const events: string[] = [];
    const client = new PlatformRealtimeClient({
      baseUrl: 'https://platform.example.com',
      eventsPath: '/api/v1/events',
      accessToken: 'secret-token',
    });

    const stop = client.connect((event) => events.push(event.id));

    await new Promise((resolve) => setTimeout(resolve, 220));
    stop();

    expect(vi.mocked(fetchMock).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(events).toContain('evt-1');
    expect(events).toContain('evt-2');
  });

  it('authenticates websocket using first frame', () => {
    vi.stubGlobal('fetch', undefined);

    const socketConstructArgs: string[] = [];
    const sendSpy = vi.fn();
    class FakeWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((message: { data: unknown }) => void) | null = null;
      onerror: ((error: unknown) => void) | null = null;

      constructor(url: string) {
        socketConstructArgs.push(url);
        queueMicrotask(() => this.onopen?.());
      }

      send = sendSpy;
      close = vi.fn();
    }

    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);

    const client = new PlatformRealtimeClient({
      baseUrl: 'https://platform.example.com',
      eventsPath: '/api/v1/events',
      accessToken: 'secret-token',
    });

    client.connect(() => {});

    expect(socketConstructArgs[0]).toBe('wss://platform.example.com/api/v1/events');
    expect(socketConstructArgs[0]).not.toContain('secret-token');
    expect(socketConstructArgs[0]).not.toContain('access_token');
  });

  it('sends auth token in websocket first frame payload', async () => {
    vi.stubGlobal('fetch', undefined);

    const sendSpy = vi.fn();
    class FakeWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((message: { data: unknown }) => void) | null = null;
      onerror: ((error: unknown) => void) | null = null;

      constructor(_url: string) {
        queueMicrotask(() => this.onopen?.());
      }

      send = sendSpy;
      close = vi.fn();
    }

    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);

    const client = new PlatformRealtimeClient({
      baseUrl: 'https://platform.example.com',
      eventsPath: '/api/v1/events',
      accessToken: 'secret-token',
    });

    client.connect(() => {});
    await Promise.resolve();

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'auth', token: 'secret-token' }));
  });
});
