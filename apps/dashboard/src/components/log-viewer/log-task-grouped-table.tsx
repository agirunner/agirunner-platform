import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { LogEntry } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { LogEntryRow, LogTableHeader } from './log-entry-row.js';
import { LogEntryDetail } from './log-entry-detail.js';
import { Skeleton } from '../ui/skeleton.js';

const SKELETON_COUNT = 6;
const COL_COUNT = 11;

interface TaskBucket {
  taskId: string;
  taskTitle: string;
  role: string | null;
  entries: LogEntry[];
}

function groupByTask(entries: LogEntry[]): {
  buckets: TaskBucket[];
  ungroupedCount: number;
} {
  const buckets = new Map<string, TaskBucket>();
  let ungroupedCount = 0;

  for (const entry of entries) {
    const taskId = entry.task_id;
    if (!taskId) {
      ungroupedCount++;
      continue;
    }

    const existing = buckets.get(taskId);
    if (existing) {
      existing.entries.push(entry);
    } else {
      buckets.set(taskId, {
        taskId,
        taskTitle: entry.task_title ?? taskId.slice(0, 8),
        role: entry.role ?? null,
        entries: [entry],
      });
    }
  }

  return { buckets: Array.from(buckets.values()), ungroupedCount };
}

function TaskGroupHeader({
  bucket,
  isExpanded,
  onToggle,
}: {
  bucket: TaskBucket;
  isExpanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const Chevron = isExpanded ? ChevronDown : ChevronRight;

  return (
    <tr
      className="border-b border-border bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors"
      onClick={onToggle}
    >
      <td colSpan={COL_COUNT} className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Chevron className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{bucket.taskTitle}</span>
          {bucket.role && (
            <span className="rounded bg-rose-50 px-1.5 py-px text-[10px] font-medium text-rose-600">
              {bucket.role}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {bucket.entries.length}{' '}
            {bucket.entries.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      </td>
    </tr>
  );
}

export interface LogTaskGroupedTableProps {
  entries: LogEntry[];
  isLoading: boolean;
  onFilterTrace: (traceId: string) => void;
}

export function LogTaskGroupedTable({
  entries,
  isLoading,
  onFilterTrace,
}: LogTaskGroupedTableProps): JSX.Element {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [expandedEntryId, setExpandedEntryId] = useState<number | null>(null);

  const { buckets, ungroupedCount } = useMemo(() => groupByTask(entries), [entries]);

  function toggleTask(taskId: string): void {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  const isEmpty = entries.length === 0 && !isLoading;

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse">
        <LogTableHeader />
        <tbody>
          {isLoading && (
            <>
              {Array.from({ length: SKELETON_COUNT }, (_, i) => (
                <tr key={i} className="border-b border-border/40">
                  <td colSpan={COL_COUNT} className="px-3 py-2">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))}
            </>
          )}

          {!isLoading && isEmpty && (
            <tr>
              <td
                colSpan={COL_COUNT}
                className="py-12 text-center text-sm text-muted-foreground"
              >
                No log entries match your filters.
              </td>
            </tr>
          )}

          {!isLoading &&
            buckets.map((bucket) => {
              const isTaskExpanded = expandedTasks.has(bucket.taskId);
              return (
                <Fragment key={bucket.taskId}>
                  <TaskGroupHeader
                    bucket={bucket}
                    isExpanded={isTaskExpanded}
                    onToggle={() => toggleTask(bucket.taskId)}
                  />
                  {isTaskExpanded &&
                    bucket.entries.map((entry) => {
                      const isEntryExpanded = expandedEntryId === entry.id;
                      return (
                        <Fragment key={entry.id}>
                          <LogEntryRow
                            entry={entry}
                            isExpanded={isEntryExpanded}
                            onToggle={() =>
                              setExpandedEntryId((prev) =>
                                prev === entry.id ? null : entry.id,
                              )
                            }
                          />
                          {isEntryExpanded && (
                            <tr className="border-b border-border/40 bg-muted/30">
                              <td colSpan={COL_COUNT} className="p-0">
                                <LogEntryDetail
                                  entry={entry}
                                  onFilterTrace={onFilterTrace}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}

          {!isLoading && ungroupedCount > 0 && buckets.length > 0 && (
            <tr className="border-b border-border bg-muted/30">
              <td
                colSpan={COL_COUNT}
                className="px-3 py-1.5 text-xs text-muted-foreground font-medium"
              >
                {ungroupedCount} non-step{' '}
                {ungroupedCount === 1 ? 'entry' : 'entries'} (switch to
                flat view to see all)
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
