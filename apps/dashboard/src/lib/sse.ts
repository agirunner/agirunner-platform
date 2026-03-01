import { readSession } from './session.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';
const EVENTS_PATH = '/api/v1/events';

export function subscribeToEvents(onEvent: (eventType: string, payload: Record<string, unknown>) => void): () => void {
  const controller = new AbortController();

  async function run(): Promise<void> {
    while (!controller.signal.aborted) {
      try {
        const session = readSession();
        if (!session) {
          return;
        }
        if (!session.accessToken) {
          await sleep(500);
          continue;
        }

        const response = await fetch(`${API_BASE_URL}${EVENTS_PATH}`, {
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
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

        while (!controller.signal.aborted) {
          const next = await reader.read();
          if (next.done) {
            break;
          }

          buffer += decoder.decode(next.value, { stream: true });
          buffer = processSseBuffer(buffer, onEvent);
        }
      } catch {
        await sleep(2000);
      }
    }
  }

  void run();
  return () => controller.abort();
}

export function processSseBuffer(buffer: string, onEvent: (eventType: string, payload: Record<string, unknown>) => void): string {
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
      onEvent(eventType, JSON.parse(data) as Record<string, unknown>);
    } catch {
      // ignore malformed payloads
    }
  });

  return pending;
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
