import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { LogEntry } from '../../lib/api.js';
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
const COL_COUNT = 11;

function SkeletonRows(): JSX.Element {
  return (
    <>
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <tr key={i} className="border-b border-border/40">
          <td className="px-1 py-1.5"><Skeleton className="h-3 w-3" /></td>
          <td className="px-0.5 py-1.5"><Skeleton className="h-3 w-3 rounded-full" /></td>
          <td className="px-1.5 py-1.5"><Skeleton className="h-3 w-10 rounded" /></td>
          <td className="px-1.5 py-1.5"><Skeleton className="h-3 w-20" /></td>
          <td className="px-1.5 py-1.5"><Skeleton className="h-3 w-16 rounded" /></td>
          <td className="hidden lg:table-cell px-1.5 py-1.5"><Skeleton className="h-3 w-16 rounded" /></td>
          <td className="hidden lg:table-cell px-1.5 py-1.5"><Skeleton className="h-3 w-16 rounded" /></td>
          <td className="hidden lg:table-cell px-1.5 py-1.5"><Skeleton className="h-3 w-12 rounded" /></td>
          <td className="px-1.5 py-1.5"><Skeleton className="h-3 w-32" /></td>
          <td className="hidden md:table-cell px-1.5 py-1.5"><Skeleton className="h-3 w-24" /></td>
          <td className="px-1.5 py-1.5 text-right"><Skeleton className="h-3 w-10 ml-auto" /></td>
        </tr>
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
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse">
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
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
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
