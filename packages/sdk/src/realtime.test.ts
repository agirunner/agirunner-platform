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

  it('does not include access token in WebSocket URL or protocol', () => {
    vi.stubGlobal('fetch', undefined);

    const socketConstructArgs: string[] = [];
    class FakeWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((message: { data: unknown }) => void) | null = null;
      onerror: ((error: unknown) => void) | null = null;

      constructor(url: string) {
        socketConstructArgs.push(url);
      }

      send = vi.fn();
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
});
