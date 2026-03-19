import { useCallback, useEffect, useRef, useState } from 'react';

import { readSession } from './session.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';
const MAX_EVENTS = 500;

export interface TaskStreamEvent {
  type: 'token' | 'thinking' | 'tool_call' | 'tool_result' | 'turn_end' | 'task_end' | 'error';
  data: Record<string, unknown>;
  agentId?: string;
  role?: string;
  turn?: number;
}

export interface UseTaskStreamOptions {
  agentId?: string;
  fromTurn?: number;
}

export interface UseTaskStreamReturn {
  events: TaskStreamEvent[];
  isConnected: boolean;
  error: string | null;
  clearEvents: () => void;
}

/**
 * Parses a raw SSE event into a TaskStreamEvent.
 * Returns null if the data is not valid JSON.
 */
export function parseStreamEvent(
  eventType: string,
  dataStr: string,
): TaskStreamEvent | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(dataStr) as Record<string, unknown>;
  } catch {
    return null;
  }

  const agentId = typeof parsed['agentId'] === 'string' ? parsed['agentId'] : undefined;
  const role = typeof parsed['role'] === 'string' ? parsed['role'] : undefined;
  const turn = typeof parsed['turn'] === 'number' ? parsed['turn'] : undefined;

  return {
    type: eventType as TaskStreamEvent['type'],
    data: parsed,
    ...(agentId !== undefined && { agentId }),
    ...(role !== undefined && { role }),
    ...(turn !== undefined && { turn }),
  };
}

/**
 * Appends a new event to the buffer, dropping the oldest entry if the buffer
 * is already at capacity. Does not mutate the input array.
 */
export function appendWithCap(
  events: TaskStreamEvent[],
  newEvent: TaskStreamEvent,
  maxSize: number,
): TaskStreamEvent[] {
  const next = [...events, newEvent];
  if (next.length > maxSize) {
    return next.slice(next.length - maxSize);
  }
  return next;
}

function buildStreamUrl(taskId: string, options: UseTaskStreamOptions): string {
  const params = new URLSearchParams();
  if (options.agentId !== undefined) {
    params.set('agent_id', options.agentId);
  }
  if (options.fromTurn !== undefined) {
    params.set('from_turn', String(options.fromTurn));
  }
  const query = params.toString();
  const base = `${API_BASE_URL}/api/v1/tasks/${taskId}/stream`;
  return query ? `${base}?${query}` : base;
}

/**
 * Connects to the task stream SSE endpoint and provides parsed events.
 *
 * Uses fetch with Authorization header (not EventSource) because EventSource
 * does not support custom headers — same pattern as the main sse.ts transport.
 *
 * When taskId changes: closes the old connection, opens a new one, clears events.
 * When taskId becomes null: closes connection, clears events.
 * On task_end event: closes connection, sets isConnected to false.
 * On unmount: closes connection.
 */
export function useTaskStream(
  taskId: string | null,
  options: UseTaskStreamOptions = {},
): UseTaskStreamReturn {
  const [events, setEvents] = useState<TaskStreamEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Keep a stable ref for options to avoid re-triggering the effect on every render
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  useEffect(() => {
    if (taskId === null) {
      abortRef.current?.abort();
      abortRef.current = null;
      setEvents([]);
      setIsConnected(false);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setEvents([]);
    setIsConnected(false);
    setError(null);

    void connectTaskStream(taskId, optionsRef.current, controller, {
      onConnected: () => {
        setIsConnected(true);
        setError(null);
      },
      onEvent: (event) => {
        setEvents((prev) => appendWithCap(prev, event, MAX_EVENTS));
        if (event.type === 'task_end') {
          setIsConnected(false);
          controller.abort();
        }
      },
      onError: (message) => {
        setIsConnected(false);
        setError(message);
      },
      onClose: () => {
        setIsConnected(false);
      },
    });

    return () => {
      controller.abort();
    };
  }, [taskId]);

  return { events, isConnected, error, clearEvents };
}

interface StreamCallbacks {
  onConnected: () => void;
  onEvent: (event: TaskStreamEvent) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

async function connectTaskStream(
  taskId: string,
  options: UseTaskStreamOptions,
  controller: AbortController,
  callbacks: StreamCallbacks,
): Promise<void> {
  const session = readSession();
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
  };
  if (session?.accessToken) {
    headers['Authorization'] = `Bearer ${session.accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(buildStreamUrl(taskId, options), {
      headers,
      credentials: 'include',
      signal: controller.signal,
    });
  } catch (err) {
    if (!controller.signal.aborted) {
      callbacks.onError(err instanceof Error ? err.message : 'Connection failed');
    }
    return;
  }

  if (!response.ok || !response.body) {
    callbacks.onError(`Stream request failed: ${response.status}`);
    return;
  }

  callbacks.onConnected();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (!controller.signal.aborted) {
      const next = await reader.read();
      if (next.done) {
        break;
      }

      buffer += decoder.decode(next.value, { stream: true });
      buffer = processSseChunk(buffer, callbacks.onEvent);
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      callbacks.onError(err instanceof Error ? err.message : 'Stream error');
      return;
    }
  }

  callbacks.onClose();
}

function processSseChunk(
  buffer: string,
  onEvent: (event: TaskStreamEvent) => void,
): string {
  const messages = buffer.split('\n\n');
  const pending = messages.pop() ?? '';

  for (const raw of messages) {
    const lines = raw.split('\n');
    const eventType = extractFieldValue(lines, 'event:') ?? 'message';
    const data = extractFieldValue(lines, 'data:');
    if (!data) {
      continue;
    }
    const parsed = parseStreamEvent(eventType, data);
    if (parsed !== null) {
      onEvent(parsed);
    }
  }

  return pending;
}

function extractFieldValue(lines: string[], prefix: string): string | undefined {
  const line = lines.find((item) => item.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : undefined;
}
