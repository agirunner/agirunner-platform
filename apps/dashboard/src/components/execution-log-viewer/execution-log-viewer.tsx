import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, Trash2, Lock, Unlock } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { readSession } from '../../lib/auth/session.js';
import { Button } from '../ui/button.js';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '../ui/select.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  message: string;
}

function classifyLevel(raw?: string): LogLevel {
  if (!raw) return 'info';
  const normalized = raw.toLowerCase();
  if (normalized.includes('error') || normalized.includes('fatal')) return 'error';
  if (normalized.includes('warn')) return 'warn';
  if (normalized.includes('debug') || normalized.includes('trace')) return 'debug';
  return 'info';
}

function levelClassName(level: LogLevel): string {
  switch (level) {
    case 'error':
      return 'text-red-500';
    case 'warn':
      return 'text-yellow-500';
    case 'debug':
      return 'text-gray-400';
    default:
      return 'text-foreground';
  }
}

function copyToClipboard(text: string): void {
  void navigator.clipboard.writeText(text);
}

interface ExecutionLogViewerProps {
  sseUrl: string;
}

export function ExecutionLogViewer({ sseUrl }: ExecutionLogViewerProps): JSX.Element {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [minLevel, setMinLevel] = useState<LogLevel>('debug');
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nextIdRef = useRef(0);

  const appendEntry = useCallback((level: LogLevel, message: string, timestamp?: string) => {
    setEntries((prev) => [
      ...prev,
      {
        id: nextIdRef.current++,
        timestamp: timestamp ?? new Date().toISOString(),
        level,
        message,
      },
    ]);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const session = readSession();
    const headers: Record<string, string> = {};
    if (session?.accessToken) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }

    const fullUrl = sseUrl.startsWith('http') ? sseUrl : `${API_BASE_URL}${sseUrl}`;

    void (async () => {
      try {
        const response = await fetch(fullUrl, {
          headers,
          credentials: 'include',
          signal: controller.signal,
        });

        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const messages = buffer.split('\n\n');
          buffer = messages.pop() ?? '';

          messages.forEach((raw) => {
            const lines = raw.split('\n');
            const dataLine = lines.find((l) => l.startsWith('data:'));
            if (!dataLine) return;

            const data = dataLine.slice(5).trim();
            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;
              const level = classifyLevel(parsed.level as string | undefined);
              const message = (parsed.message as string) ?? data;
              const timestamp = (parsed.timestamp as string) ?? undefined;
              appendEntry(level, message, timestamp);
            } catch {
              appendEntry('info', data);
            }
          });
        }
      } catch {
        // Connection closed or aborted
      }
    })();

    return () => controller.abort();
  }, [sseUrl, appendEntry]);

  useEffect(() => {
    if (isAutoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries, isAutoScroll]);

  const filteredEntries = entries.filter(
    (e) => LEVEL_PRIORITY[e.level] >= LEVEL_PRIORITY[minLevel],
  );

  function handleClear(): void {
    setEntries([]);
  }

  function handleDownload(): void {
    const content = filteredEntries
      .map((e) => `[${e.timestamp}] [${e.level.toUpperCase()}] ${e.message}`)
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `execution-logs-${new Date().toISOString().slice(0, 19)}.log`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Select value={minLevel} onValueChange={(v) => setMinLevel(v as LogLevel)}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOG_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {level.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {filteredEntries.length} line(s)
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            title={isAutoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
            onClick={() => setIsAutoScroll(!isAutoScroll)}
          >
            {isAutoScroll ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2" title="Clear" onClick={handleClear}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2" title="Download" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="max-h-96 overflow-y-auto rounded-md border border-border bg-black/90 p-2 font-mono text-xs"
      >
        {filteredEntries.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground">Waiting for log entries...</p>
        ) : (
          filteredEntries.map((entry) => (
            <LogLine key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }): JSX.Element {
  return (
    <div className="group flex items-start gap-2 py-0.5 hover:bg-white/5">
      <span className="flex-shrink-0 text-gray-500">
        {new Date(entry.timestamp).toLocaleTimeString()}
      </span>
      <span className={cn('w-12 flex-shrink-0 text-right uppercase', levelClassName(entry.level))}>
        {entry.level}
      </span>
      <span className="flex-1 whitespace-pre-wrap text-gray-200">{entry.message}</span>
      <button
        type="button"
        title="Copy line"
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-300"
        onClick={() => copyToClipboard(`[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`)}
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}
