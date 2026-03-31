import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../../../lib/api.js';
import { readSession } from '../../../lib/auth/session.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';
const RATE_WINDOW_MS = 5_000;
const MAX_BACKOFF_MS = 8_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_RETRIES = 5;

export interface UseLogStreamOptions {
  enabled: boolean;
  filters: Record<string, string>;
  onEntry: (entry: LogEntry) => void;
}

export interface UseLogStreamResult {
  isConnected: boolean;
  entriesPerSecond: number;
  bufferedCount: number;
  error: string | null;
}

function buildStreamUrl(filters: Record<string, string>): string {
  const params = new URLSearchParams(filters);
  return `${API_BASE_URL}/api/v1/logs/stream?${params.toString()}`;
}

export function useLogStream({
  enabled,
  filters,
  onEntry,
}: UseLogStreamOptions): UseLogStreamResult {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entriesPerSecond, setEntriesPerSecond] = useState(0);
  const [bufferedCount, setBufferedCount] = useState(0);

  const timestampsRef = useRef<number[]>([]);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const onEntryRef = useRef(onEntry);
  onEntryRef.current = onEntry;

  const filtersKey = JSON.stringify(filters);

  const trackRate = useCallback(() => {
    const now = Date.now();
    timestampsRef.current.push(now);
    const cutoff = now - RATE_WINDOW_MS;
    timestampsRef.current = timestampsRef.current.filter((t) => t > cutoff);
    setEntriesPerSecond(
      Math.round(timestampsRef.current.length / (RATE_WINDOW_MS / 1000)),
    );
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsConnected(false);
      setError(null);
      setEntriesPerSecond(0);
      setBufferedCount(0);
      return;
    }

    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let retryCount = 0;

    async function connect(): Promise<void> {
      const session = readSession();
      if (!session) {
        setError('Not authenticated');
        setIsConnected(false);
        return;
      }

      const headers: Record<string, string> = {};
      if (session.accessToken) {
        headers.Authorization = `Bearer ${session.accessToken}`;
      }

      const parsedFilters = JSON.parse(filtersKey) as Record<string, string>;
      const url = buildStreamUrl(parsedFilters);

      try {
        const response = await fetch(url, {
          headers,
          credentials: 'include',
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          setError(`Server returned ${response.status}`);
          setIsConnected(false);
          scheduleReconnect();
          return;
        }

        setIsConnected(true);
        setError(null);
        backoffRef.current = INITIAL_BACKOFF_MS;
        retryCount = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let pending = 0;

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const messages = buffer.split('\n\n');
          buffer = messages.pop() ?? '';

          for (const raw of messages) {
            const lines = raw.split('\n');
            const eventLine = lines.find((l) => l.startsWith('event:'));
            if (eventLine?.includes('heartbeat')) continue;

            const dataLine = lines.find((l) => l.startsWith('data:'));
            if (!dataLine) continue;

            const data = dataLine.slice(5).trim();
            try {
              const entry = JSON.parse(data) as LogEntry;
              onEntryRef.current(entry);
              trackRate();
              pending++;
            } catch {
              // Skip malformed entries
            }
          }

          setBufferedCount(pending);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const isNetworkError = err instanceof TypeError;
        const message = isNetworkError
          ? 'Cannot reach API server'
          : err instanceof Error ? err.message : 'Connection lost';
        setError(message);
        setIsConnected(false);
        scheduleReconnect();
      }
    }

    function scheduleReconnect(): void {
      if (controller.signal.aborted) return;
      retryCount++;
      if (retryCount > MAX_RETRIES) {
        setError('Stream unavailable — click Go live to retry');
        return;
      }
      reconnectTimer = setTimeout(() => {
        backoffRef.current = Math.min(
          backoffRef.current * 2,
          MAX_BACKOFF_MS,
        );
        void connect();
      }, backoffRef.current);
    }

    void connect();

    return () => {
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [enabled, filtersKey, trackRate]);

  return { isConnected, entriesPerSecond, bufferedCount, error };
}
