import { ChevronRight, ChevronDown } from 'lucide-react';
import type { LogEntry } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../ui/badge.js';
import { formatLogRelativeTime } from './log-time.js';
import {
  describeLogActivityDetail,
  describeLogActivityTitle,
  describeLogActorDetail,
  describeLogActorLabel,
  describeLogCategoryLabel,
  describeWorkflowStageSummary,
} from './log-entry-presentation.js';

export interface LogEntryRowProps {
  entry: LogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

const LEVEL_ACCENT: Record<string, string> = {
  debug: 'border-l-transparent',
  info: 'border-l-blue-400',
  warn: 'border-l-yellow-500',
  error: 'border-l-red-500',
};

const LEVEL_BADGE_VARIANT: Record<string, 'info' | 'warning' | 'destructive'> = {
  debug: 'info',
  info: 'info',
  warn: 'warning',
  error: 'destructive',
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mon}/${day} ${hh}:${mm}:${ss}`;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(t: string, max: number): string {
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export function LogTableHeader(): JSX.Element {
  return (
    <thead>
      <tr className="border-b border-border bg-muted/35 text-[11px] uppercase tracking-wider text-foreground/70">
        <th className="w-6 px-1 py-1.5" />
        <th className="px-3 py-2 text-left font-medium">Time</th>
        <th className="px-3 py-2 text-left font-medium">Level</th>
        <th className="px-3 py-2 text-left font-medium">Category</th>
        <th className="px-3 py-2 text-left font-medium">Workflow / Stage</th>
        <th className="px-3 py-2 text-left font-medium">Actor</th>
        <th className="px-3 py-2 text-left font-medium">Activity</th>
        <th className="px-3 py-2 text-right font-medium w-20">Duration</th>
      </tr>
    </thead>
  );
}

export function LogEntryRow({ entry, isExpanded, onToggle }: LogEntryRowProps): JSX.Element {
  const accent = LEVEL_ACCENT[entry.level] ?? LEVEL_ACCENT.info;
  const Chevron = isExpanded ? ChevronDown : ChevronRight;
  const duration = formatDuration(entry.duration_ms);
  const workflowStage = describeWorkflowStageSummary(entry);
  const actorDetail = describeLogActorDetail(entry);
  const activityTitle = describeLogActivityTitle(entry);
  const activityDetail = describeLogActivityDetail(entry);

  return (
    <tr
      className={cn(
        'border-b border-border/40 border-l-2 cursor-pointer align-top text-[13px] transition-colors hover:bg-muted/40',
        accent,
      )}
      onClick={onToggle}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {/* Expand chevron */}
      <td className="px-2 py-2 align-top">
        <Chevron className="h-3 w-3 text-muted-foreground" />
      </td>

      {/* Time */}
      <td className="px-3 py-2.5 align-top">
        <div
          className="text-sm font-medium text-foreground"
          title={formatTimestamp(entry.created_at)}
        >
          {formatLogRelativeTime(entry.created_at)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{formatTimestamp(entry.created_at)}</div>
      </td>

      {/* Level */}
      <td className="px-3 py-2.5 align-top">
        <Badge
          variant={LEVEL_BADGE_VARIANT[entry.level] ?? 'info'}
          className="px-1.5 py-0.5 font-mono text-[11px] uppercase leading-tight"
        >
          {entry.level}
        </Badge>
      </td>

      {/* Category */}
      <td className="px-3 py-2.5 align-top">
        <span className="inline-block whitespace-nowrap text-sm font-medium text-foreground">
          {describeLogCategoryLabel(entry.category)}
        </span>
      </td>

      {/* Workflow / Stage */}
      <td className="px-3 py-2.5 align-top">
        <div className="min-w-[14rem]">
          <div className="break-words text-sm font-medium text-foreground">{workflowStage.workflow}</div>
          <div className="mt-1 break-words text-xs text-muted-foreground">{workflowStage.stage}</div>
        </div>
      </td>

      {/* Actor */}
      <td className="px-3 py-2.5 align-top">
        <div className="min-w-[11rem]">
          <div className="break-words text-sm font-medium text-foreground">{describeLogActorLabel(entry)}</div>
          <div className="mt-1 break-words text-xs text-muted-foreground">{actorDetail}</div>
        </div>
      </td>

      {/* Activity */}
      <td className="px-3 py-2.5 align-top">
        <div className="grid min-w-[20rem] gap-1">
          <div className="break-words text-sm font-medium text-foreground">
            {activityTitle}
          </div>
          <div className="break-words text-xs text-muted-foreground">
            {truncate(activityDetail, 140)}
          </div>
          {entry.error?.message ? (
            <div className="rounded-md border border-rose-300 bg-rose-100 px-2 py-1 text-xs leading-5 text-rose-900 dark:border-rose-400/80 dark:bg-rose-500/22 dark:text-rose-50">
              {truncate(entry.error.message, 160)}
            </div>
          ) : null}
        </div>
      </td>

      {/* Duration */}
      <td className="px-3 py-2.5 align-top text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap">
        {duration}
      </td>
    </tr>
  );
}
