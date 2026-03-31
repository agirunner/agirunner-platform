import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import type { DashboardWorkflowRailRow } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import type { WorkflowPageMode } from './workflows-page.support.js';
import { WorkflowRailRowCard } from './workflows-rail-row.js';

const ONGOING_PREVIEW_LIMIT = 5;
const THEMED_SCROLL_STYLE = {
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(148, 163, 184, 0.5) transparent',
} as const;
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function WorkflowsRail(props: {
  mode: WorkflowPageMode;
  search: string;
  needsActionOnly: boolean;
  ongoingOnly: boolean;
  visibleCount?: number;
  totalCount?: number;
  rows: DashboardWorkflowRailRow[];
  ongoingRows: DashboardWorkflowRailRow[];
  selectedWorkflowId: string | null;
  selectedWorkflowRow?: DashboardWorkflowRailRow | null;
  hasNextPage: boolean;
  isLoading: boolean;
  onModeChange(mode: WorkflowPageMode): void;
  onSearchChange(value: string): void;
  onNeedsActionOnlyChange(nextValue: boolean): void;
  onShowAllOngoing(): void;
  onClearOngoingFilter(): void;
  onSelectWorkflow(workflowId: string): void;
  onLoadMore(): void;
  onCreateWorkflow(): void;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const persistedScrollTopRef = useRef(0);
  const selectionRestoreFrameRef = useRef<number | null>(null);
  const handleSelectWorkflow = (workflowId: string) => {
    if (scrollRef.current) {
      persistedScrollTopRef.current = scrollRef.current.scrollTop;
    }
    props.onSelectWorkflow(workflowId);
  };
  const ongoingPreviewRows = useMemo(
    () => props.ongoingRows.slice(0, ONGOING_PREVIEW_LIMIT),
    [props.ongoingRows],
  );
  const visibleRows = useMemo(
    () => {
      if (props.mode !== 'live') {
        return props.rows;
      }
      if (props.ongoingOnly) {
        return props.ongoingRows;
      }
      return props.rows.filter((row) => row.lifecycle !== 'ongoing');
    },
    [props.mode, props.ongoingOnly, props.ongoingRows, props.rows],
  );
  const selectedVisible = useMemo(
    () =>
      props.selectedWorkflowId
        ? ongoingPreviewRows.some((row) => row.workflow_id === props.selectedWorkflowId)
          || visibleRows.some((row) => row.workflow_id === props.selectedWorkflowId)
        : true,
    [ongoingPreviewRows, props.selectedWorkflowId, visibleRows],
  );
  const shouldShowMainEmptyState =
    visibleRows.length === 0 && (props.mode !== 'live' || ongoingPreviewRows.length === 0);
  const shouldShowLoadingState = props.isLoading && shouldShowMainEmptyState;
  const visibleCount = props.visibleCount ?? countVisibleRows(props.rows, props.ongoingRows);
  const totalCount = props.totalCount ?? visibleCount;
  const activeFilterSummary = buildActiveFilterSummary({
    search: props.search,
    needsActionOnly: props.needsActionOnly,
    ongoingOnly: props.ongoingOnly,
  });

  useIsomorphicLayoutEffect(() => {
    if (!scrollRef.current) {
      return;
    }

    const restoreScrollPosition = () => {
      if (!scrollRef.current) {
        return;
      }
      scrollRef.current.scrollTop = persistedScrollTopRef.current;
    };

    restoreScrollPosition();
    if (typeof window === 'undefined') {
      return;
    }

    if (selectionRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(selectionRestoreFrameRef.current);
    }
    selectionRestoreFrameRef.current = window.requestAnimationFrame(() => {
      restoreScrollPosition();
      selectionRestoreFrameRef.current = null;
    });

    return () => {
      if (selectionRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionRestoreFrameRef.current);
        selectionRestoreFrameRef.current = null;
      }
    };
  }, [props.selectedWorkflowId, selectedVisible]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    const sentinelElement = loadMoreSentinelRef.current;
    if (
      !scrollElement
      || !sentinelElement
      || !props.hasNextPage
      || props.isLoading
      || typeof IntersectionObserver === 'undefined'
    ) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          props.onLoadMore();
        }
      },
      {
        root: scrollElement,
        rootMargin: '160px 0px',
        threshold: 0,
      },
    );

    observer.observe(sentinelElement);
    return () => observer.disconnect();
  }, [props.hasNextPage, props.isLoading, props.onLoadMore, visibleRows.length]);

  return (
    <aside className="flex h-full max-h-[18rem] min-h-0 w-full flex-col overflow-hidden rounded-[1.25rem] border border-border/70 bg-background/95 shadow-sm dark:bg-slate-950/85 sm:max-h-[24rem] lg:max-h-none">
      <div className="space-y-3 border-b border-border/70 px-3 py-3 sm:px-4 sm:py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Workflows</h1>
          </div>
          <Button size="sm" onClick={props.onCreateWorkflow}>
            New Workflow
          </Button>
        </div>

        <div className="grid gap-3">
          <Input
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder="Search workflows"
          />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ModeButton
              isActive={props.mode === 'live'}
              label="Live"
              onClick={() => props.onModeChange('live')}
            />
            <ModeButton
              isActive={props.mode === 'recent'}
              label="Recent"
              onClick={() => props.onModeChange('recent')}
            />
            <FilterToggleButton
              label="Needs Action Only"
              isActive={props.needsActionOnly}
              onClick={() => props.onNeedsActionOnlyChange(!props.needsActionOnly)}
            />
            {props.ongoingOnly ? (
              <Button
                size="sm"
                type="button"
                variant="ghost"
                onClick={props.onClearOngoingFilter}
              >
                Clear Ongoing
              </Button>
            ) : null}
          </div>
          <div className="grid gap-1">
            <p className="text-xs text-muted-foreground">{visibleCount} shown · {totalCount} total</p>
            {activeFilterSummary ? (
              <p className="truncate text-xs text-muted-foreground">{activeFilterSummary}</p>
            ) : null}
          </div>
        </div>
      </div>

      {props.selectedWorkflowRow && props.selectedWorkflowId && !selectedVisible ? (
        <section className="border-b border-border/70 px-4 py-3">
          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Selected workflow
            </p>
            <WorkflowRailRowCard
              row={props.selectedWorkflowRow}
              isSelected
              onSelect={handleSelectWorkflow}
            />
          </div>
        </section>
      ) : null}

      {props.mode === 'live' && !props.ongoingOnly && ongoingPreviewRows.length > 0 ? (
        <section className="space-y-3 border-b border-border/70 px-3 py-3 sm:px-4 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">Ongoing</p>
            {props.ongoingRows.length > ONGOING_PREVIEW_LIMIT ? (
              <Button size="sm" type="button" variant="ghost" onClick={props.onShowAllOngoing}>
                Show all
              </Button>
            ) : null}
          </div>
          <div className="grid gap-2">
            {ongoingPreviewRows.map((row) => (
              <WorkflowRailRowCard
                key={`ongoing:${row.workflow_id}`}
                row={row}
                isSelected={row.workflow_id === props.selectedWorkflowId}
                onSelect={handleSelectWorkflow}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div
        ref={scrollRef}
        data-workflows-rail-scroll-region="true"
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3"
        style={THEMED_SCROLL_STYLE}
        onScroll={(event) => {
          const element = event.currentTarget;
          persistedScrollTopRef.current = element.scrollTop;
          const nearBottom =
            element.scrollTop + element.clientHeight >= element.scrollHeight - 120;
          if (nearBottom && props.hasNextPage && !props.isLoading) {
            props.onLoadMore();
          }
        }}
      >
        <div className="grid gap-2">
          {shouldShowLoadingState ? (
            <div
              aria-live="polite"
              className="px-1 py-2 text-sm text-muted-foreground"
            >
              Loading workflows…
            </div>
          ) : shouldShowMainEmptyState ? (
            <div className="px-1 py-2 text-sm text-muted-foreground">
              No workflows match the current filters.
            </div>
          ) : visibleRows.length > 0 ? (
            visibleRows.map((row) => (
              <WorkflowRailRowCard
                key={row.workflow_id}
                row={row}
                isSelected={row.workflow_id === props.selectedWorkflowId}
                onSelect={handleSelectWorkflow}
              />
            ))
          ) : null}
          {props.hasNextPage ? (
            <div
              ref={loadMoreSentinelRef}
              aria-hidden="true"
              data-workflows-rail-load-more-sentinel="true"
              className="h-1 w-full"
            />
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function countVisibleRows(rows: DashboardWorkflowRailRow[], ongoingRows: DashboardWorkflowRailRow[]): number {
  return rows.length + ongoingRows.length;
}

function buildActiveFilterSummary(input: {
  search: string;
  needsActionOnly: boolean;
  ongoingOnly: boolean;
}): string | null {
  const parts: string[] = [];
  const search = input.search.trim();
  if (search.length > 0) {
    parts.push(`Search: ${search}`);
  }
  if (input.needsActionOnly) {
    parts.push('Needs Action');
  }
  if (input.ongoingOnly) {
    parts.push('Ongoing');
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function ModeButton(props: {
  isActive: boolean;
  label: string;
  onClick(): void;
}): JSX.Element {
  return (
    <Button size="sm" type="button" variant={props.isActive ? 'default' : 'outline'} onClick={props.onClick}>
      {props.label}
    </Button>
  );
}

function FilterToggleButton(props: {
  label: string;
  isActive: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.isActive}
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        props.isActive
          ? 'border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-50'
          : 'border-border bg-background text-foreground hover:bg-border/30',
      )}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}
