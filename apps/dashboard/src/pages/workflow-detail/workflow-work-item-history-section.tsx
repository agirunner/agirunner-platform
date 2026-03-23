import { useEffect, useMemo, useState } from 'react';

import type { DashboardEventRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { WorkItemHistoryFilterBar, WorkItemHistoryPagination } from './workflow-work-item-history-controls.js';
import { WorkItemHistoryEntry } from './workflow-work-item-history-entry.js';
import {
  buildWorkItemHistoryOverview,
} from './workflow-work-item-history-support.js';
import {
  WORK_ITEM_HISTORY_PAGE_SIZE,
  buildWorkItemHistoryRecords,
  filterAndSortWorkItemHistoryRecords,
  filtersToSavedViewState,
  loadPersistedWorkItemHistoryFilters,
  paginateWorkItemHistoryRecords,
  persistWorkItemHistoryFilters,
  savedViewStateToFilters,
  totalHistoryPages,
} from './workflow-work-item-history-filters.js';

const loadingTextClass =
  'rounded-lg border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted';
const errorTextClass =
  'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700';

export function WorkItemEventHistorySection(props: {
  workflowId: string;
  workItemId: string;
  isLoading: boolean;
  hasError: boolean;
  events: DashboardEventRecord[];
}): JSX.Element {
  const storageKey = useMemo(
    () => `${props.workflowId}:${props.workItemId}`,
    [props.workflowId, props.workItemId],
  );
  const [filters, setFilters] = useState(() => loadPersistedWorkItemHistoryFilters(storageKey));
  const [page, setPage] = useState(0);

  useEffect(() => {
    setFilters(loadPersistedWorkItemHistoryFilters(storageKey));
    setPage(0);
  }, [storageKey]);

  useEffect(() => {
    persistWorkItemHistoryFilters(storageKey, filters);
  }, [filters, storageKey]);

  const records = useMemo(
    () => buildWorkItemHistoryRecords(props.events),
    [props.events],
  );
  const filteredRecords = useMemo(
    () => filterAndSortWorkItemHistoryRecords(records, filters),
    [filters, records],
  );
  const totalPages = useMemo(
    () => totalHistoryPages(filteredRecords.length, WORK_ITEM_HISTORY_PAGE_SIZE),
    [filteredRecords.length],
  );

  useEffect(() => {
    setPage(0);
  }, [filters.query, filters.signal, filters.sort]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, Math.max(0, totalPages - 1)));
  }, [totalPages]);

  if (props.isLoading) {
    return <p className={loadingTextClass}>Loading work-item history...</p>;
  }
  if (props.hasError) {
    return <p className={errorTextClass}>Failed to load work-item history.</p>;
  }
  if (props.events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
        No work-item events recorded yet.
      </div>
    );
  }

  const filteredEvents = filteredRecords.map((record) => record.event);
  const overview = buildWorkItemHistoryOverview(filteredEvents);
  const focusLabel = normalizeDisplayText(overview.focusLabel) ?? 'Latest activity';
  const focusDetail =
    normalizeDisplayText(overview.focusDetail) ?? 'Latest activity is ready for operator review.';
  const visibleRecords = paginateWorkItemHistoryRecords(
    filteredRecords,
    page,
    WORK_ITEM_HISTORY_PAGE_SIZE,
  );
  const activeFilters = filtersToSavedViewState(filters);
  const hasActiveFilters = Object.keys(activeFilters).length > 0;

  return (
    <section className="grid gap-4 rounded-xl border border-border/70 bg-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-1">
          <strong className="text-base">Event history</strong>
          <p className="text-sm leading-6 text-muted">
            Review operator-facing activity packets, then step into the linked specialist record only when you need deeper execution detail.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{filteredRecords.length} visible</Badge>
          <Badge variant="outline">{props.events.length} total entries</Badge>
        </div>
      </div>

      <WorkItemHistoryFilterBar
        totalCount={props.events.length}
        visibleCount={filteredRecords.length}
        filters={filters}
        savedViewFilters={activeFilters}
        savedViewStorageKey={`work-item-history:${storageKey}`}
        onQueryChange={(value) =>
          setFilters((currentFilters) => ({ ...currentFilters, query: value }))
        }
        onSignalChange={(value) =>
          setFilters((currentFilters) => ({ ...currentFilters, signal: value }))
        }
        onSortChange={(value) =>
          setFilters((currentFilters) => ({ ...currentFilters, sort: value }))
        }
        onApplySavedView={(savedFilters) => setFilters(savedViewStateToFilters(savedFilters))}
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-1 rounded-xl border border-border/70 bg-background/80 p-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Latest operator signal
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-foreground">{focusLabel}</div>
            <Badge variant={overview.focusTone}>{focusLabel}</Badge>
          </div>
          <p className="text-sm leading-6 text-muted">{focusDetail}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:w-[28rem]">
          {overview.metrics.map((metric) => (
            <div
              key={metric.label}
              className="grid gap-1 rounded-xl border border-border/70 bg-background/80 p-4"
            >
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                {normalizeDisplayText(metric.label) ?? 'Metric'}
              </div>
              <div className="text-sm font-semibold text-foreground">
                {normalizeDisplayText(metric.value) ?? '—'}
              </div>
              <div className="text-xs leading-5 text-muted">
                {normalizeDisplayText(metric.detail) ?? 'No operator detail available.'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
          {hasActiveFilters
            ? 'No work-item events match the current history filters. Adjust the saved view or filter bar to bring the relevant activity back into scope.'
            : 'No work-item events are visible in this history slice.'}
        </div>
      ) : (
        <>
          <ul className="grid gap-3" data-testid="work-item-history-list">
            {visibleRecords.map((record) => (
              <WorkItemHistoryEntry key={record.packet.id} packet={record.packet} />
            ))}
          </ul>
          <WorkItemHistoryPagination
            currentPage={page}
            totalPages={totalPages}
            visibleCount={filteredRecords.length}
            pageSize={WORK_ITEM_HISTORY_PAGE_SIZE}
            onPrevious={() => setPage((currentPage) => Math.max(0, currentPage - 1))}
            onNext={() =>
              setPage((currentPage) => Math.min(totalPages - 1, currentPage + 1))
            }
          />
        </>
      )}
    </section>
  );
}

function normalizeDisplayText(value: unknown, depth = 0): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => normalizeDisplayText(entry, depth + 1))
      .filter((entry): entry is string => Boolean(entry));
    return entries.length > 0 ? entries.join(', ') : null;
  }
  const record = asRecord(value);
  if (depth < 2) {
    for (const preferredValue of [
      record.label,
      record.title,
      record.name,
      record.summary,
      record.message,
      record.id,
      record.count,
    ]) {
      const normalized = normalizeDisplayText(preferredValue, depth + 1);
      if (normalized) {
        return normalized;
      }
    }
  }
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return null;
  }
  return `Structured ${humanizeDisplayKey(keys[0])}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function humanizeDisplayKey(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
