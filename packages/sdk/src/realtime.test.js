import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformRealtimeClient } from './realtime.js';
describe('PlatformRealtimeClient auth transport', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });
    it('does not include access token in SSE URL', async () => {
        const urlCalls = [];
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"id":"evt-1"}\n\n'));
                controller.close();
            },
        });
        const fetchMock = vi.fn(async (input) => {
            urlCalls.push(String(input));
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });
        vi.stubGlobal('fetch', fetchMock);
        const client = new PlatformRealtimeClient({
            baseUrl: 'https://platform.example.com',
            eventsPath: '/api/v1/events',
            accessToken: 'secret-token',
        });
        const stop = client.connect(() => { });
        await Promise.resolve();
        stop();
        expect(urlCalls[0]).toBe('https://platform.example.com/api/v1/events');
        expect(urlCalls[0]).not.toContain('secret-token');
        expect(urlCalls[0]).not.toContain('access_token');
    });
    it('reconnects SSE stream after disconnect', async () => {
        vi.useFakeTimers();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"id":"evt-1"}\n\n'));
                controller.close();
            },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
            .mockResolvedValueOnce(new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"id":"evt-2"}\n\n'));
                controller.close();
            },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
        vi.stubGlobal('fetch', fetchMock);
        const events = [];
        const client = new PlatformRealtimeClient({
            baseUrl: 'https://platform.example.com',
            eventsPath: '/api/v1/events',
            accessToken: 'secret-token',
        });
        const stop = client.connect((event) => events.push(event.id));
        await Promise.resolve();
        await Promise.resolve();
        expect(events).toContain('evt-1');
        await vi.advanceTimersByTimeAsync(100);
        await Promise.resolve();
        stop();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(events).toContain('evt-1');
        expect(events).toContain('evt-2');
    });
    it('authenticates websocket using first frame', () => {
        vi.stubGlobal('fetch', undefined);
        const socketConstructArgs = [];
        const sendSpy = vi.fn();
        class FakeWebSocket {
            onopen = null;
            onmessage = null;
            onerror = null;
            constructor(url) {
                socketConstructArgs.push(url);
                queueMicrotask(() => this.onopen?.());
            }
            send = sendSpy;
            close = vi.fn();
        }
        vi.stubGlobal('WebSocket', FakeWebSocket);
        const client = new PlatformRealtimeClient({
            baseUrl: 'https://platform.example.com',
            eventsPath: '/api/v1/events',
            accessToken: 'secret-token',
        });
        client.connect(() => { });
        expect(socketConstructArgs[0]).toBe('wss://platform.example.com/api/v1/events');
        expect(socketConstructArgs[0]).not.toContain('secret-token');
        expect(socketConstructArgs[0]).not.toContain('access_token');
    });
    it('sends auth token in websocket first frame payload', async () => {
        vi.stubGlobal('fetch', undefined);
        const sendSpy = vi.fn();
        class FakeWebSocket {
            onopen = null;
            onmessage = null;
            onerror = null;
            constructor(_url) {
                queueMicrotask(() => this.onopen?.());
            }
            send = sendSpy;
            close = vi.fn();
        }
        vi.stubGlobal('WebSocket', FakeWebSocket);
        const client = new PlatformRealtimeClient({
            baseUrl: 'https://platform.example.com',
            eventsPath: '/api/v1/events',
            accessToken: 'secret-token',
        });
        client.connect(() => { });
        await Promise.resolve();
        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'auth', token: 'secret-token' }));
    });
});
