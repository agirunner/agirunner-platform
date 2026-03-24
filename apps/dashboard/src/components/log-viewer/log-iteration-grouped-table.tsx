import { Fragment, useMemo, useState } from 'react';
import type { LogEntry } from '../../lib/api.js';
import { LogTableHeader, LogEntryRow } from './log-entry-row.js';
import { LogEntryDetail } from './log-entry-detail.js';
import { LogIterationGroup } from './log-iteration-group.js';
import { Skeleton } from '../ui/skeleton.js';

const SKELETON_COUNT = 6;
const COL_COUNT = 8;

export interface IterationBucket {
  iteration: number;
  entries: LogEntry[];
}

export function groupByIteration(entries: LogEntry[]): {
  buckets: IterationBucket[];
  ungroupedCount: number;
} {
  const buckets = new Map<number, LogEntry[]>();
  let ungroupedCount = 0;

  for (const entry of entries) {
    if (typeof entry.payload?.iteration === 'number') {
      const iteration = entry.payload.iteration;
      const existing = buckets.get(iteration);
      if (existing) {
        existing.push(entry);
      } else {
        buckets.set(iteration, [entry]);
      }
    } else {
      ungroupedCount++;
    }
  }

  const sorted = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([iteration, grouped]) => ({ iteration, entries: grouped }));

  return { buckets: sorted, ungroupedCount };
}

export interface LogIterationGroupedTableProps {
  entries: LogEntry[];
  isLoading: boolean;
  onFilterTrace: (traceId: string) => void;
}

export function LogIterationGroupedTable({
  entries,
  isLoading,
  onFilterTrace,
}: LogIterationGroupedTableProps): JSX.Element {
  const [expandedIterations, setExpandedIterations] = useState<Set<number>>(
    new Set(),
  );
  const [expandedEntryId, setExpandedEntryId] = useState<number | null>(null);

  const { buckets, ungroupedCount } = useMemo(() => groupByIteration(entries), [entries]);

  const hasIterationGroups = buckets.length > 0;

  function toggleIteration(iteration: number): void {
    setExpandedIterations((prev) => {
      const next = new Set(prev);
      if (next.has(iteration)) {
        next.delete(iteration);
      } else {
        next.add(iteration);
      }
      return next;
    });
  }

  const isEmpty = entries.length === 0 && !isLoading;

  /* When no entries have iteration data, render all entries as a flat list */
  const flatEntries = hasIterationGroups ? [] : entries;

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

          {/* Flat fallback: no iteration groups found */}
          {!isLoading &&
            flatEntries.map((entry) => {
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
                    <tr className="border-b border-border/40">
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

          {/* Iteration groups */}
          {!isLoading &&
            buckets.map((bucket) => (
              <LogIterationGroup
                key={bucket.iteration}
                iteration={bucket.iteration}
                entries={bucket.entries}
                isExpanded={expandedIterations.has(bucket.iteration)}
                onToggle={() => toggleIteration(bucket.iteration)}
                onFilterTrace={onFilterTrace}
              />
            ))}

          {!isLoading && ungroupedCount > 0 && hasIterationGroups && (
            <tr className="border-b border-border bg-muted/30">
              <td
                colSpan={COL_COUNT}
                className="px-3 py-1.5 text-xs text-muted-foreground font-medium"
              >
                {ungroupedCount} non-iteration{' '}
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
