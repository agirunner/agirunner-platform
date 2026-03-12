import { useCallback, useMemo, useState } from 'react';
import type { LogEntry } from '../../lib/api.js';
import { LogFilters } from './log-filters.js';
import { LogTable } from './log-table.js';
import { LogExportButton } from './log-export-button.js';
import { LogViewToggle, type LogViewMode } from './log-view-toggle.js';
import { LogIterationGroupedTable } from './log-iteration-grouped-table.js';
import { LogTaskGroupedTable } from './log-task-grouped-table.js';
import { useLogQuery } from './hooks/use-log-query.js';
import { useLogFilters } from './hooks/use-log-filters.js';
import { applyLogScope, type LogScope } from './log-scope.js';

const QUERY_REFETCH_INTERVAL_MS = 5_000;
const FLAT_PAGE_SIZE = 100;
const GROUPED_PAGE_SIZE = 500;

export interface LogViewerProps {
  scope?: LogScope;
  compact?: boolean;
}

export function LogViewer({ scope, compact = false }: LogViewerProps): JSX.Element {
  const [cursor, setCursor] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<LogViewMode>('flat');

  const { filters, setFilter, toQueryParams } = useLogFilters();

  const isGrouped = viewMode !== 'flat';
  const pageSize = isGrouped ? GROUPED_PAGE_SIZE : FLAT_PAGE_SIZE;

  const queryParams = useMemo(() => applyLogScope(toQueryParams(), scope), [toQueryParams, scope]);

  const { data: logData, isLoading: isLoadingLogs } = useLogQuery(
    queryParams,
    cursor,
    true,
    QUERY_REFETCH_INTERVAL_MS,
    pageSize,
  );

  const handleLoadMore = useCallback((nextCursor: string) => {
    setCursor(nextCursor);
  }, []);

  const handleFilterTrace = useCallback(
    (traceId: string) => {
      setFilter('trace', traceId);
      setCursor(null);
    },
    [setFilter],
  );

  const handleViewModeChange = useCallback(
    (mode: LogViewMode) => {
      setViewMode(mode);
      setCursor(null);

      // Auto-apply category filters relevant to the grouping mode
      if (mode === 'by-iteration') {
        setFilter('categories', ['agent_loop']);
      } else if (mode === 'by-task') {
        setFilter('categories', ['agent_loop', 'llm', 'tool', 'task_lifecycle', 'container']);
      } else {
        // Flat view: clear category filter to show everything
        setFilter('categories', []);
      }
    },
    [setFilter],
  );

  const displayEntries = logData?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <LogFilters
        hideEntityScope={Boolean(scope)}
        compact={compact}
        viewMode={viewMode}
        onViewModeChange={(mode) => handleViewModeChange(mode as LogViewMode)}
        scope={scope}
      />

      {/* Toolbar: view toggle */}
      <div className="flex items-center justify-end gap-2">
        <LogViewToggle mode={viewMode} onChange={handleViewModeChange} />
      </div>

      {viewMode === 'flat' && (
        <LogTable
          entries={displayEntries}
          isLoading={isLoadingLogs}
          hasMore={logData?.pagination?.has_more ?? false}
          nextCursor={logData?.pagination?.next_cursor}
          prevCursor={logData?.pagination?.prev_cursor}
          onLoadMore={handleLoadMore}
          onFilterTrace={handleFilterTrace}
          exportSlot={<LogExportButton scope={scope} />}
        />
      )}

      {viewMode === 'by-iteration' && (
        <LogIterationGroupedTable
          entries={displayEntries}
          isLoading={isLoadingLogs}
          onFilterTrace={handleFilterTrace}
        />
      )}

      {viewMode === 'by-task' && (
        <LogTaskGroupedTable
          entries={displayEntries}
          isLoading={isLoadingLogs}
          onFilterTrace={handleFilterTrace}
        />
      )}
    </div>
  );
}
