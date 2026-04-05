import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { FilterX, SlidersHorizontal } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js';
import {
  SearchableCombobox,
  type ComboboxItem,
} from '../../components/log-viewer/ui/searchable-combobox.js';
import type { DashboardPlaybookRecord, DashboardWorkflowRailRow } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import type {
  WorkflowPageMode,
  WorkflowRailUpdatedWindow,
} from './workflows-page.support.js';
import { WorkflowRailRowCard } from './workflows-rail-row.js';

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
  lifecycleFilter?: 'all' | 'ongoing' | 'planned';
  playbookId: string | null;
  updatedWithin: WorkflowRailUpdatedWindow;
  ongoingOnly?: boolean;
  visibleCount?: number;
  totalCount?: number;
  rows: DashboardWorkflowRailRow[];
  ongoingRows: DashboardWorkflowRailRow[];
  playbooks: DashboardPlaybookRecord[];
  selectedWorkflowId: string | null;
  selectedWorkflowRow?: DashboardWorkflowRailRow | null;
  hasNextPage: boolean;
  isLoading: boolean;
  onModeChange(mode: WorkflowPageMode): void;
  onLifecycleFilterChange(filter: 'all' | 'ongoing' | 'planned'): void;
  onPlaybookFilterChange(playbookId: string | null): void;
  onSearchChange(value: string): void;
  onNeedsActionOnlyChange(nextValue: boolean): void;
  onUpdatedWithinChange(value: WorkflowRailUpdatedWindow): void;
  onShowAllOngoing?(): void;
  onClearOngoingFilter?(): void;
  onSelectWorkflow(workflowId: string): void;
  onLoadMore(): void;
  onCreateWorkflow(): void;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const persistedScrollTopRef = useRef(0);
  const selectionRestoreFrameRef = useRef<number | null>(null);
  const playbooks = props.playbooks ?? [];
  const handleSelectWorkflow = (workflowId: string) => {
    if (scrollRef.current) {
      persistedScrollTopRef.current = scrollRef.current.scrollTop;
    }
    props.onSelectWorkflow(workflowId);
  };
  const lifecycleFilter = props.lifecycleFilter ?? (props.ongoingOnly ? 'ongoing' : 'all');
  const unifiedRows = useMemo(
    () => sortRailRows([...props.ongoingRows, ...props.rows]),
    [props.ongoingRows, props.rows],
  );
  const visibleRows = useMemo(
    () => {
      switch (lifecycleFilter) {
        case 'ongoing':
          return unifiedRows.filter((row) => row.lifecycle === 'ongoing');
        case 'planned':
          return unifiedRows.filter((row) => row.lifecycle === 'planned');
        case 'all':
        default:
          return unifiedRows;
      }
    },
    [lifecycleFilter, unifiedRows],
  );
  const selectedVisible = useMemo(
    () =>
      props.selectedWorkflowId
        ? visibleRows.some((row) => row.workflow_id === props.selectedWorkflowId)
        : true,
    [props.selectedWorkflowId, visibleRows],
  );
  const hasServerDrivenFilters =
    props.search.trim().length > 0
    || props.needsActionOnly
    || props.playbookId !== null
    || props.updatedWithin !== 'all';
  const hiddenSelectedRow =
    props.selectedWorkflowRow && props.selectedWorkflowId && !selectedVisible && !hasServerDrivenFilters
      ? props.selectedWorkflowRow
      : null;
  const displayRows = hiddenSelectedRow ? [hiddenSelectedRow, ...visibleRows] : visibleRows;
  const shouldShowMainEmptyState = displayRows.length === 0;
  const shouldShowLoadingState = props.isLoading && shouldShowMainEmptyState;
  const visibleCount = props.visibleCount ?? countVisibleRows(props.rows, props.ongoingRows);
  const totalCount = props.totalCount ?? visibleCount;
  const selectedPlaybookLabel = useMemo(
    () =>
      props.playbookId
        ? playbooks.find((playbook) => playbook.id === props.playbookId)?.name ?? 'Selected playbook'
        : null,
    [playbooks, props.playbookId],
  );
  const advancedFilterCount = countAdvancedFilters({
    playbookId: props.playbookId,
    updatedWithin: props.updatedWithin,
  });
  const activeFilterSummary = buildActiveFilterSummary({
    search: props.search,
    needsActionOnly: props.needsActionOnly,
    lifecycleFilter,
    playbookLabel: selectedPlaybookLabel,
    updatedWithin: props.updatedWithin,
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
    <aside className="relative isolate flex h-full max-h-[18rem] min-h-0 w-full flex-col overflow-hidden rounded-[1.25rem] border border-border/70 bg-background/95 shadow-sm dark:border-slate-800/90 dark:bg-slate-950 dark:shadow-none sm:max-h-[24rem] lg:max-h-none">
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
          <div className="flex min-w-0 items-center gap-2">
            <Input
              value={props.search}
              onChange={(event) => props.onSearchChange(event.target.value)}
              placeholder="Search workflows"
              className="min-w-0 flex-1"
            />
            <RailFiltersPopover
              playbooks={playbooks}
              playbookId={props.playbookId}
              updatedWithin={props.updatedWithin}
              activeFilterCount={advancedFilterCount}
              onPlaybookFilterChange={props.onPlaybookFilterChange}
              onUpdatedWithinChange={props.onUpdatedWithinChange}
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <LifecycleButton
              isActive={lifecycleFilter === 'all'}
              label="All"
              onClick={() => props.onLifecycleFilterChange('all')}
            />
            <LifecycleButton
              isActive={lifecycleFilter === 'ongoing'}
              label="Ongoing"
              onClick={() => props.onLifecycleFilterChange('ongoing')}
            />
            <LifecycleButton
              isActive={lifecycleFilter === 'planned'}
              label="Planned"
              onClick={() => props.onLifecycleFilterChange('planned')}
            />
            <FilterToggleButton
              label="Needs Action Only"
              isActive={props.needsActionOnly}
              onClick={() => props.onNeedsActionOnlyChange(!props.needsActionOnly)}
            />
          </div>
          <div className="grid gap-1">
            <p className="text-xs text-muted-foreground">{visibleCount} shown · {totalCount} total</p>
            {activeFilterSummary ? (
              <p className="truncate text-xs text-muted-foreground">{activeFilterSummary}</p>
            ) : null}
          </div>
        </div>
      </div>

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
        <div className="flex flex-col gap-2">
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
          ) : displayRows.length > 0 ? (
            displayRows.map((row) => (
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
  lifecycleFilter: 'all' | 'ongoing' | 'planned';
  playbookLabel: string | null;
  updatedWithin: WorkflowRailUpdatedWindow;
}): string | null {
  const parts: string[] = [];
  const search = input.search.trim();
  if (search.length > 0) {
    parts.push(`Search: ${search}`);
  }
  if (input.needsActionOnly) {
    parts.push('Needs Action');
  }
  if (input.lifecycleFilter === 'ongoing') {
    parts.push('Ongoing');
  }
  if (input.lifecycleFilter === 'planned') {
    parts.push('Planned');
  }
  if (input.playbookLabel) {
    parts.push(`Playbook: ${input.playbookLabel}`);
  }
  if (input.updatedWithin !== 'all') {
    parts.push(`Updated ${readUpdatedWithinLabel(input.updatedWithin)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function countAdvancedFilters(input: {
  playbookId: string | null;
  updatedWithin: WorkflowRailUpdatedWindow;
}): number {
  let count = 0;
  if (input.playbookId) {
    count += 1;
  }
  if (input.updatedWithin !== 'all') {
    count += 1;
  }
  return count;
}

function readUpdatedWithinLabel(value: WorkflowRailUpdatedWindow): string {
  switch (value) {
    case '24h':
      return '24h';
    case '7d':
      return '7d';
    case '30d':
      return '30d';
    default:
      return 'All time';
  }
}

function LifecycleButton(props: {
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
          ? 'border-sky-300/80 bg-sky-100/90 text-sky-950 shadow-sm dark:border-sky-400/50 dark:bg-sky-400/15 dark:text-sky-50'
          : 'border-border bg-background text-foreground hover:bg-border/30',
      )}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

function sortRailRows(rows: DashboardWorkflowRailRow[]): DashboardWorkflowRailRow[] {
  return [...rows].sort((left, right) => readRailTimestamp(right) - readRailTimestamp(left));
}

function readRailTimestamp(row: DashboardWorkflowRailRow): number {
  const millis = row.last_changed_at ? Date.parse(row.last_changed_at) : 0;
  return Number.isFinite(millis) ? millis : 0;
}

function RailFiltersPopover(props: {
  playbooks: DashboardPlaybookRecord[];
  playbookId: string | null;
  updatedWithin: WorkflowRailUpdatedWindow;
  activeFilterCount: number;
  onPlaybookFilterChange(playbookId: string | null): void;
  onUpdatedWithinChange(value: WorkflowRailUpdatedWindow): void;
}): JSX.Element {
  const playbookItems = useMemo<ComboboxItem[]>(
    () =>
      props.playbooks.map((playbook) => ({
        id: playbook.id,
        label: playbook.name,
        subtitle: playbook.slug,
      })),
    [props.playbooks],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="shrink-0">
          <SlidersHorizontal className="h-4 w-4" />
          {props.activeFilterCount > 0 ? `Filters (${props.activeFilterCount})` : 'Filters'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border/70 bg-background/95 p-3 shadow-lg">
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Filters</p>
              <p className="text-xs text-muted-foreground">Server-driven rail filters for large workflow sets.</p>
            </div>
            {props.activeFilterCount > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1.5 px-2"
                onClick={() => {
                  props.onPlaybookFilterChange(null);
                  props.onUpdatedWithinChange('all');
                }}
              >
                <FilterX className="h-4 w-4" />
                Clear
              </Button>
            ) : null}
          </div>

          <div className="grid gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Playbook
            </p>
            <SearchableCombobox
              items={playbookItems}
              value={props.playbookId}
              onChange={props.onPlaybookFilterChange}
              placeholder="All playbooks"
              searchPlaceholder="Search playbooks..."
              allGroupLabel="Playbooks"
            />
          </div>

          <div className="grid gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Last updated
            </p>
            <div className="flex flex-wrap gap-2">
              {(['all', '24h', '7d', '30d'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    'inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    props.updatedWithin === value
                      ? 'border-sky-300/80 bg-sky-100/90 text-sky-950 shadow-sm dark:border-sky-400/50 dark:bg-sky-400/15 dark:text-sky-50'
                      : 'border-border bg-background text-foreground hover:bg-border/30',
                  )}
                  onClick={() => props.onUpdatedWithinChange(value)}
                >
                  {value === 'all' ? 'All time' : readUpdatedWithinLabel(value)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
