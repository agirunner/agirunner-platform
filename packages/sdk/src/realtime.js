export class PlatformRealtimeClient {
    options;
    constructor(options) {
        this.options = {
            ...options,
            eventsPath: options.eventsPath ?? '/api/v1/events',
        };
    }
    connect(onEvent, onError) {
        if (typeof fetch === 'function') {
            return this.connectSse(onEvent, onError);
        }
        return this.connectWebSocket(onEvent, onError);
    }
    connectSse(onEvent, onError) {
        const controller = new AbortController();
        void this.streamEventsWithReconnect(controller.signal, onEvent, onError);
        return () => controller.abort();
    }
    async streamEventsWithReconnect(signal, onEvent, onError) {
        while (!signal.aborted) {
            try {
                await this.streamEvents(signal, onEvent, onError);
            }
            catch (error) {
                if (signal.aborted) {
                    return;
                }
                onError?.(error);
            }
            if (signal.aborted) {
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    async streamEvents(signal, onEvent, onError) {
        const response = await fetch(`${this.options.baseUrl}${this.options.eventsPath}`, {
            headers: { Authorization: `Bearer ${this.options.accessToken}` },
            credentials: 'include',
            signal,
        });
        if (!response.ok || !response.body) {
            onError?.(new Error(`SSE connection failed with HTTP ${response.status}`));
            return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        while (!signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done) {
                return;
            }
            pending += decoder.decode(chunk.value, { stream: true });
            pending = this.processSseBuffer(pending, onEvent, onError);
        }
    }
    processSseBuffer(buffer, onEvent, onError) {
        const messages = buffer.split('\n\n');
        const remainder = messages.pop() ?? '';
        messages.forEach((message) => {
            const dataLine = message
                .split('\n')
                .find((line) => line.startsWith('data:'))
                ?.slice(5)
                .trim();
            if (!dataLine) {
                return;
            }
            try {
                onEvent(JSON.parse(dataLine));
            }
            catch (error) {
                onError?.(error);
            }
        });
        return remainder;
    }
    connectWebSocket(onEvent, onError) {
        const WebSocketCtor = globalThis.WebSocket;
        if (!WebSocketCtor) {
            throw new Error('No fetch or WebSocket implementation available');
        }
        const wsProtocol = this.options.baseUrl.startsWith('https://') ? 'wss' : 'ws';
        const wsUrl = this.options.baseUrl.replace(/^https?/, wsProtocol);
        const socket = new WebSocketCtor(`${wsUrl}${this.options.eventsPath}`);
        socket.onopen = () => {
            socket.send(JSON.stringify({ type: 'auth', token: this.options.accessToken }));
        };
        socket.onmessage = (message) => {
            try {
                onEvent(JSON.parse(String(message.data)));
            }
            catch (error) {
                onError?.(error);
            }
        };
        socket.onerror = (error) => {
            onError?.(error);
        };
        return () => socket.close();
    }
}
