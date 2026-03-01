import type { PlatformEvent } from './types.js';

export interface RealtimeClientOptions {
  baseUrl: string;
  accessToken: string;
  eventsPath?: string;
}

export type Unsubscribe = () => void;

type WebSocketLike = {
  onopen: (() => void) | null;
  onmessage: ((message: { data: unknown }) => void) | null;
  onerror: ((error: unknown) => void) | null;
  send: (data: string) => void;
  close: () => void;
};

type WebSocketConstructor = new (url: string) => WebSocketLike;

export class PlatformRealtimeClient {
  private readonly options: RealtimeClientOptions;

  constructor(options: RealtimeClientOptions) {
    this.options = {
      ...options,
      eventsPath: options.eventsPath ?? '/api/v1/events',
    };
  }

  connect(onEvent: (event: PlatformEvent) => void, onError?: (error: unknown) => void): Unsubscribe {
    if (typeof fetch === 'function') {
      return this.connectSse(onEvent, onError);
    }

    return this.connectWebSocket(onEvent, onError);
  }

  private connectSse(onEvent: (event: PlatformEvent) => void, onError?: (error: unknown) => void): Unsubscribe {
    const controller = new AbortController();
    void this.streamEvents(controller.signal, onEvent, onError).catch((error) => {
      if (!controller.signal.aborted) {
        onError?.(error);
      }
    });
    return () => controller.abort();
  }

  private async streamEvents(
    signal: AbortSignal,
    onEvent: (event: PlatformEvent) => void,
    onError?: (error: unknown) => void,
  ): Promise<void> {
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

  private processSseBuffer(
    buffer: string,
    onEvent: (event: PlatformEvent) => void,
    onError?: (error: unknown) => void,
  ): string {
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
        onEvent(JSON.parse(dataLine) as PlatformEvent);
      } catch (error) {
        onError?.(error);
      }
    });

    return remainder;
  }

  private connectWebSocket(onEvent: (event: PlatformEvent) => void, onError?: (error: unknown) => void): Unsubscribe {
    const WebSocketCtor = (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
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
        onEvent(JSON.parse(String(message.data)) as PlatformEvent);
      } catch (error) {
        onError?.(error);
      }
    };

    socket.onerror = (error) => {
      onError?.(error);
    };

    return () => socket.close();
  }
}
