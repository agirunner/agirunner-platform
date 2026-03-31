import { readSession } from './auth/session.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';
const EVENTS_PATH = '/api/v1/events/stream';
const EVENTS_WS_PATH = '/api/v1/events/ws';

export interface StreamEventPayload {
  id?: number | string;
  type?: string;
  entity_type?: string;
  entity_id?: string;
  actor_type?: string;
  actor_id?: string | null;
  created_at?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EventSubscriptionOptions {
  eventTypes?: string[];
  eventTypePrefixes?: string[];
  entityTypes?: string[];
}

interface Subscriber {
  id: number;
  onEvent: (eventType: string, payload: StreamEventPayload) => void;
  options: EventSubscriptionOptions;
}

const subscribers = new Map<number, Subscriber>();
let subscriberCounter = 0;
let streamController: AbortController | null = null;
let streamLoopPromise: Promise<void> | null = null;
let socket: WebSocket | null = null;
let socketFallbackActive = false;

export function subscribeToEvents(
  onEvent: (eventType: string, payload: StreamEventPayload) => void,
  options: EventSubscriptionOptions = {},
): () => void {
  const id = ++subscriberCounter;
  subscribers.set(id, { id, onEvent, options });

  ensureStreamLoop();

  return () => {
    subscribers.delete(id);
    if (subscribers.size === 0) {
      stopStreamLoop();
    }
  };
}

export function resetEventTransportForTests(): void {
  subscribers.clear();
  subscriberCounter = 0;
  socket?.close();
  socket = null;
  streamController?.abort();
  streamController = null;
  streamLoopPromise = null;
  socketFallbackActive = false;
}

export function processSseBuffer(
  buffer: string,
  onEvent: (eventType: string, payload: StreamEventPayload) => void,
): string {
  const messages = buffer.split('\n\n');
  const pending = messages.pop() ?? '';

  messages.forEach((raw) => {
    const lines = raw.split('\n');
    const eventType = extractValue(lines, 'event:') ?? 'message';
    const data = extractValue(lines, 'data:');
    if (!data) {
      return;
    }

    try {
      onEvent(eventType, JSON.parse(data) as StreamEventPayload);
    } catch {
      // ignore malformed payloads
    }
  });

  return pending;
}

export function matchesSubscription(
  eventType: string,
  payload: StreamEventPayload,
  options: EventSubscriptionOptions,
): boolean {
  if (options.eventTypes?.length && !options.eventTypes.includes(eventType)) {
    return false;
  }

  if (
    options.eventTypePrefixes?.length
    && !options.eventTypePrefixes.some((prefix) => eventType.startsWith(prefix))
  ) {
    return false;
  }

  const payloadEntityType = typeof payload.entity_type === 'string' ? payload.entity_type : undefined;
  if (options.entityTypes?.length && (!payloadEntityType || !options.entityTypes.includes(payloadEntityType))) {
    return false;
  }

  return true;
}

function ensureStreamLoop(): void {
  if (streamLoopPromise || subscribers.size === 0) {
    return;
  }

  if (ensureWebsocketConnection()) {
    return;
  }

  streamController = new AbortController();
  streamLoopPromise = runStreamLoop(streamController)
    .catch(() => {
      // swallow: loop already retries internally; allow next subscription to restart stream
    })
    .finally(() => {
      streamLoopPromise = null;
      streamController = null;
      if (subscribers.size > 0 && readSession()) {
        ensureStreamLoop();
      }
    });
}

function stopStreamLoop(): void {
  socket?.close();
  socket = null;
  streamController?.abort();
}

function ensureWebsocketConnection(): boolean {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
    return false;
  }
  if (socket && socket.readyState !== WebSocket.CLOSED) {
    return true;
  }

  const session = readSession();
  if (!session?.accessToken) {
    return false;
  }

  try {
    socket = new WebSocket(buildWebsocketUrl());
  } catch {
    socket = null;
    return false;
  }

  socketFallbackActive = false;
  socket.addEventListener('open', () => {
    socket?.send(JSON.stringify({ action: 'authenticate', token: session.accessToken }));
  });
  socket.addEventListener('message', (event) => {
    handleWebsocketMessage(event.data);
  });
  socket.addEventListener('close', () => {
    socket = null;
    if (subscribers.size > 0 && !socketFallbackActive) {
      socketFallbackActive = true;
      ensureStreamLoop();
    }
  });
  socket.addEventListener('error', () => {
    socketFallbackActive = true;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close();
    }
  });

  return true;
}

async function runStreamLoop(controller: AbortController): Promise<void> {
  while (!controller.signal.aborted && subscribers.size > 0) {
    try {
      const session = readSession();
      if (!session) {
        return;
      }

      const headers = session.accessToken
        ? {
            Authorization: `Bearer ${session.accessToken}`,
          }
        : undefined;

      const response = await fetch(`${API_BASE_URL}${EVENTS_PATH}`, {
        headers,
        credentials: 'include',
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        await sleep(2000);
        continue;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!controller.signal.aborted && subscribers.size > 0) {
        const next = await reader.read();
        if (next.done) {
          break;
        }

        buffer += decoder.decode(next.value, { stream: true });
        buffer = processSseBuffer(buffer, dispatchEvent);
      }
    } catch {
      if (!controller.signal.aborted) {
        await sleep(2000);
      }
    }
  }
}

function dispatchEvent(eventType: string, payload: StreamEventPayload): void {
  for (const subscriber of subscribers.values()) {
    if (!matchesSubscription(eventType, payload, subscriber.options)) {
      continue;
    }

    subscriber.onEvent(eventType, payload);
  }
}

function handleWebsocketMessage(raw: string | ArrayBufferLike | Blob | ArrayBufferView): void {
  if (typeof raw !== 'string') {
    return;
  }

  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    switch (payload.type) {
      case 'authenticated':
        socket?.send(JSON.stringify({ action: 'subscribe', filters: {} }));
        return;
      case 'event':
        dispatchEvent(
          typeof payload.event_type === 'string' ? payload.event_type : 'message',
          {
            id: payload.event_id as string | number | undefined,
            type: payload.event_type as string | undefined,
            entity_type: payload.entity_type as string | undefined,
            entity_id: payload.entity_id as string | undefined,
            data: (payload.data as Record<string, unknown> | undefined) ?? {},
            created_at: payload.timestamp as string | undefined,
          },
        );
        return;
      default:
        return;
    }
  } catch {
    // ignore malformed websocket payloads
  }
}

function buildWebsocketUrl(): string {
  const normalized = API_BASE_URL.replace(/^http/, 'ws');
  return `${normalized}${EVENTS_WS_PATH}`;
}

function extractValue(lines: string[], prefix: string): string | undefined {
  const line = lines.find((item) => item.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
