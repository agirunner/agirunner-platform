import { ChevronDown, ChevronRight } from 'lucide-react';

import type { LogEntry } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import {
  describeExecutionHeadline,
  describeExecutionSummary,
  formatDuration,
  levelVariant,
  readExecutionSignals,
  statusVariant,
  summarizeLogContext,
} from '../execution-inspector/execution-inspector-support.js';
import { Badge } from '../ui/badge.js';
import { LogEntryDetail } from './log-entry-detail.js';
import { formatLogRelativeTime } from './log-time.js';

interface LogEntryMobileCardProps {
  entry: LogEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onFilterTrace: (traceId: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  llm: 'LLM',
  tool: 'Tool',
  agent_loop: 'Agent Loop',
  task_lifecycle: 'Step',
  runtime_lifecycle: 'Runtime',
  container: 'Container',
  api: 'API',
  config: 'Config',
  auth: 'Auth',
};

function formatAbsoluteTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown time';
}

export function LogEntryMobileCard(props: LogEntryMobileCardProps): JSX.Element {
  const { entry, isExpanded, onToggle, onFilterTrace } = props;
  const signals = readExecutionSignals(entry);
  const context = summarizeLogContext(entry).slice(0, 2);

  return (
    <article
      className={cn(
        'rounded-2xl border border-border/70 bg-card/90 shadow-sm transition-colors',
        isExpanded && 'ring-1 ring-border',
      )}
    >
      <button
        type="button"
        className="flex w-full flex-col gap-3 p-4 text-left"
        onClick={onToggle}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant={levelVariant(entry.level)}>{entry.level}</Badge>
            <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
            <Badge variant="outline">{CATEGORY_LABELS[entry.category] ?? entry.category}</Badge>
          </div>
          <span className="shrink-0 text-muted-foreground">
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {entry.operation}
          </div>
          <div className="font-medium leading-6 text-foreground">
            {describeExecutionHeadline(entry)}
          </div>
          <div className="text-sm leading-6 text-muted-foreground">
            {describeExecutionSummary(entry)}
          </div>
        </div>

        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="grid gap-1">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              Recorded
            </span>
            <time dateTime={entry.created_at} title={formatAbsoluteTimestamp(entry.created_at)}>
              {formatLogRelativeTime(entry.created_at)}
            </time>
          </div>
          <div className="grid gap-1">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              Duration
            </span>
            <span>{formatDuration(entry.duration_ms)}</span>
          </div>
        </div>

        {context.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {context.map((item) => (
              <Badge key={item} variant="outline" className="text-[11px]">
                {item}
              </Badge>
            ))}
          </div>
        ) : null}

        {signals.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {signals.map((signal) => (
              <Badge key={signal} variant="outline" className="text-[11px]">
                {signal}
              </Badge>
            ))}
          </div>
        ) : null}

        {entry.error?.message ? (
          <div className="rounded-xl border border-red-300/60 bg-red-50/60 px-3 py-2 text-sm text-red-700 dark:border-red-700/60 dark:bg-red-950/25 dark:text-red-200">
            {entry.error.message}
          </div>
        ) : null}
      </button>

      {isExpanded ? (
        <div className="border-t border-border/70 p-4">
          <LogEntryDetail entry={entry} onFilterTrace={onFilterTrace} />
        </div>
      ) : null}
    </article>
  );
}
