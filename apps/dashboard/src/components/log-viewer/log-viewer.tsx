import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LogEntry } from '../../lib/api.js';
import { LogFilters } from './log-filters.js';
import { LogTable } from './log-table.js';
import { LogViewToggle, type LogViewMode } from './log-view-toggle.js';
import { LogIterationGroupedTable } from './log-iteration-grouped-table.js';
import { LogTaskGroupedTable } from './log-task-grouped-table.js';
import { useLogQuery } from './hooks/use-log-query.js';
import { useLogFilters } from './hooks/use-log-filters.js';
import { useLogStream } from './hooks/use-log-stream.js';
import { applyLogScope, type LogScope } from './log-scope.js';
import { LogStreamIndicator } from './log-stream-indicator.js';
import type { ComboboxItem } from './ui/searchable-combobox.js';

const QUERY_REFETCH_INTERVAL_MS = 5_000;
const FLAT_PAGE_SIZE = 100;
const GROUPED_PAGE_SIZE = 500;
const LIVE_ENTRY_LIMIT = 100;

export interface LogViewerProps {
  scope?: LogScope;
  compact?: boolean;
  defaultLive?: boolean;
  operationItemsOverride?: ComboboxItem[];
  roleItemsOverride?: ComboboxItem[];
  actorItemsOverride?: ComboboxItem[];
  workspaceItemsOverride?: ComboboxItem[];
  workflowItemsOverride?: ComboboxItem[];
  taskItemsOverride?: ComboboxItem[];
  isLoadingWorkspacesOverride?: boolean;
  isLoadingWorkflowsOverride?: boolean;
  isLoadingTasksOverride?: boolean;
}

export function LogViewer({
  scope,
  compact = false,
  defaultLive = false,
  operationItemsOverride,
  roleItemsOverride,
  actorItemsOverride,
  workspaceItemsOverride,
  workflowItemsOverride,
  taskItemsOverride,
  isLoadingWorkspacesOverride,
  isLoadingWorkflowsOverride,
  isLoadingTasksOverride,
}: LogViewerProps): JSX.Element {
  const [cursor, setCursor] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<LogViewMode>('flat');
  const [isLive, setIsLive] = useState(defaultLive);
  const [liveEntries, setLiveEntries] = useState<LogEntry[]>([]);

  const { filters, setFilter, toQueryParams } = useLogFilters();

  const isGrouped = viewMode !== 'flat';
  const pageSize = isGrouped ? GROUPED_PAGE_SIZE : FLAT_PAGE_SIZE;

  const queryParams = useMemo(() => applyLogScope(toQueryParams(), scope), [toQueryParams, scope]);

  const { data: logData, isLoading: isLoadingLogs } = useLogQuery(
    queryParams,
    cursor,
    true,
    isLive ? undefined : QUERY_REFETCH_INTERVAL_MS,
    pageSize,
  );

  useEffect(() => {
    setLiveEntries([]);
  }, [cursor, isLive, queryParams, viewMode]);

  const liveStream = useLogStream({
    enabled: isLive && viewMode === 'flat',
    filters: queryParams,
    onEntry: (entry) => {
      setLiveEntries((current) => {
        const next = [entry, ...current.filter((existing) => existing.id !== entry.id)];
        return next.slice(0, LIVE_ENTRY_LIMIT);
      });
    },
  });

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

  const handleViewModeChange = useCallback((mode: LogViewMode) => {
    setViewMode(mode);
    setCursor(null);
  }, []);

  const displayEntries = useMemo(() => {
    if (viewMode !== 'flat' || liveEntries.length === 0) {
      return logData?.data ?? [];
    }
    const seen = new Set(liveEntries.map((entry) => entry.id));
    return [...liveEntries, ...(logData?.data ?? []).filter((entry) => !seen.has(entry.id))];
  }, [liveEntries, logData?.data, viewMode]);

  return (
    <div className="flex flex-col gap-4">
      <LogFilters
        hideEntityScope={Boolean(scope)}
        compact={compact}
        viewMode={viewMode}
        onViewModeChange={(mode) => handleViewModeChange(mode as LogViewMode)}
        scope={scope}
        disableOptionQueries={
          operationItemsOverride !== undefined &&
          roleItemsOverride !== undefined &&
          actorItemsOverride !== undefined
        }
        operationItemsOverride={operationItemsOverride}
        roleItemsOverride={roleItemsOverride}
        actorItemsOverride={actorItemsOverride}
        workspaceItemsOverride={workspaceItemsOverride}
        workflowItemsOverride={workflowItemsOverride}
        taskItemsOverride={taskItemsOverride}
        isLoadingWorkspacesOverride={isLoadingWorkspacesOverride}
        isLoadingWorkflowsOverride={isLoadingWorkflowsOverride}
        isLoadingTasksOverride={isLoadingTasksOverride}
      />

      {/* Toolbar: view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LogStreamIndicator
          isLive={isLive}
          isConnected={liveStream.isConnected}
          entriesPerSecond={liveStream.entriesPerSecond}
          bufferedCount={liveStream.bufferedCount}
          error={liveStream.error}
          onToggle={() => {
            setCursor(null);
            setIsLive((current) => !current);
          }}
        />
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
