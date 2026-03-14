import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { LogEntry } from '../../lib/api.js';
import { LogEntryMobileCard } from './log-entry-mobile-card.js';
import { LogEntryRow, LogTableHeader } from './log-entry-row.js';
import { LogEntryDetail } from './log-entry-detail.js';
import { Button } from '../ui/button.js';
import { Skeleton } from '../ui/skeleton.js';

export interface LogTableProps {
  entries: LogEntry[];
  isLoading: boolean;
  hasMore: boolean;
  nextCursor: string | null | undefined;
  prevCursor: string | null | undefined;
  onLoadMore: (cursor: string) => void;
  onFilterTrace: (traceId: string) => void;
  exportSlot?: ReactNode;
}

const SKELETON_COUNT = 12;
const COL_COUNT = 6;

function SkeletonRows(): JSX.Element {
  return (
    <>
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <tr key={i} className="border-b border-border/40">
          <td className="px-2 py-2.5"><Skeleton className="h-3 w-3" /></td>
          <td className="px-3 py-2.5"><Skeleton className="h-4 w-28 rounded" /></td>
          <td className="px-3 py-2.5"><Skeleton className="h-4 w-20 rounded" /></td>
          <td className="hidden lg:table-cell px-3 py-2.5"><Skeleton className="h-4 w-28 rounded" /></td>
          <td className="px-3 py-2.5"><Skeleton className="h-4 w-48 rounded" /></td>
          <td className="px-3 py-2.5 text-right"><Skeleton className="ml-auto h-4 w-10 rounded" /></td>
        </tr>
      ))}
    </>
  );
}

function MobileSkeletonCards(): JSX.Element {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
          <div className="space-y-3">
            <div className="flex gap-2">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </>
  );
}

export function LogTable({
  entries,
  isLoading,
  hasMore,
  nextCursor,
  prevCursor,
  onLoadMore,
  onFilterTrace,
  exportSlot,
}: LogTableProps): JSX.Element {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const isEmpty = entries.length === 0 && !isLoading;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:hidden">
        {isLoading ? <MobileSkeletonCards /> : null}

        {!isLoading && isEmpty ? (
          <div className="rounded-2xl border border-border/70 bg-card/90 px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">
            No log entries match your filters.
          </div>
        ) : null}

        {!isLoading
          ? entries.map((entry) => (
              <LogEntryMobileCard
                key={entry.id}
                entry={entry}
                isExpanded={expandedId === entry.id}
                onToggle={() => setExpandedId((prev) => (prev === entry.id ? null : entry.id))}
                onFilterTrace={onFilterTrace}
              />
            ))
          : null}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-border/70 bg-card/90 shadow-sm md:block">
        <table className="min-w-full border-collapse">
          <LogTableHeader />
          <tbody>
            {isLoading && <SkeletonRows />}

            {!isLoading && isEmpty && (
              <tr>
                <td colSpan={COL_COUNT} className="py-12 text-center text-sm text-muted-foreground">
                  No log entries match your filters.
                </td>
              </tr>
            )}

            {!isLoading &&
              entries.map((entry) => {
                const isExpanded = expandedId === entry.id;
                return (
                  <Fragment key={entry.id}>
                    <LogEntryRow
                      entry={entry}
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedId((prev) => (prev === entry.id ? null : entry.id))}
                    />
                    {isExpanded && (
                      <tr className="border-b border-border/40 bg-muted/30">
                        <td colSpan={COL_COUNT} className="p-0">
                          <LogEntryDetail entry={entry} onFilterTrace={onFilterTrace} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>

      {!isLoading && !isEmpty && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/80 p-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={!prevCursor}
            onClick={() => prevCursor && onLoadMore(prevCursor)}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Newer
          </Button>
          <span className="text-xs text-muted-foreground">
            Showing {entries.length} entries
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore || !nextCursor}
              onClick={() => nextCursor && onLoadMore(nextCursor)}
            >
              Older
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
            {exportSlot}
          </div>
        </div>
      )}
    </div>
  );
}
