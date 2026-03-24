import { ChevronDown, ChevronRight } from 'lucide-react';

import type { LogEntry } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import {
  describeExecutionHeadline,
  describeExecutionSummary,
  formatDuration,
  levelVariant,
} from '../execution-inspector/execution-inspector-support.js';
import { Badge } from '../ui/badge.js';
import { LogEntryDetail } from './log-entry-detail.js';
import { getCanonicalStageName } from './log-entry-context.js';
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

function describeWorkflow(entry: LogEntry): string {
  if (entry.workflow_name?.trim()) {
    return entry.workflow_name;
  }
  if (entry.workflow_id?.trim()) {
    return `Workflow ${entry.workflow_id.slice(0, 8)}`;
  }
  return 'No workflow';
}

function describeStep(entry: LogEntry): string {
  const stageName = getCanonicalStageName(entry);
  const parts = [entry.task_title?.trim() || '', stageName ? `Stage ${stageName}` : ''].filter(
    Boolean,
  );
  return parts.join(' · ') || 'No step context';
}

function describeActor(entry: LogEntry): string {
  if (entry.actor_name?.trim()) {
    return entry.actor_name;
  }
  const actorType = entry.actor_type?.replace(/_/g, ' ') || 'unknown';
  return actorType.charAt(0).toUpperCase() + actorType.slice(1);
}

function describeActorDetail(entry: LogEntry): string {
  if (entry.role?.trim()) {
    return entry.role;
  }
  const sourceLabel = entry.source.replace(/_/g, ' ');
  return sourceLabel.charAt(0).toUpperCase() + sourceLabel.slice(1);
}

function formatStatusLabel(status: string): string {
  if (!status) {
    return 'Unknown';
  }
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
}

export function LogEntryMobileCard(props: LogEntryMobileCardProps): JSX.Element {
  const { entry, isExpanded, onToggle, onFilterTrace } = props;

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
              Category
            </span>
            <span className="text-sm text-foreground">{CATEGORY_LABELS[entry.category] ?? entry.category}</span>
          </div>
          <div className="grid gap-1">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              Workflow
            </span>
            <span className="text-sm text-foreground">{describeWorkflow(entry)}</span>
            <span>{describeStep(entry)}</span>
          </div>
          <div className="grid gap-1">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              Actor
            </span>
            <span className="text-sm text-foreground">{describeActor(entry)}</span>
            <span>{describeActorDetail(entry)}</span>
          </div>
          <div className="grid gap-1">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              Status
            </span>
            <span>{formatStatusLabel(entry.status)}</span>
          </div>
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

        {entry.error?.message ? (
          <div className="rounded-xl border border-rose-300 bg-rose-100 px-3 py-2 text-sm text-rose-900 dark:border-rose-500/70 dark:bg-rose-500/12 dark:text-rose-100">
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
