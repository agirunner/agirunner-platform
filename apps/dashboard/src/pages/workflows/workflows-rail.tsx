import { useEffect, useMemo, useRef } from 'react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import type { DashboardWorkflowRailRow } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { formatRelativeTimestamp } from '../workflow-detail/workflow-detail-presentation.js';
import type { WorkflowPageMode } from './workflows-page.support.js';

const ONGOING_PREVIEW_LIMIT = 5;

export function WorkflowsRail(props: {
  mode: WorkflowPageMode;
  search: string;
  needsActionOnly: boolean;
  ongoingOnly: boolean;
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
  const persistedScrollTopRef = useRef(0);
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
  const renderedRows = useMemo(
    () =>
      props.mode === 'live' && !props.ongoingOnly
        ? [...ongoingPreviewRows, ...visibleRows]
        : visibleRows,
    [ongoingPreviewRows, props.mode, props.ongoingOnly, visibleRows],
  );
  const selectedVisible = useMemo(
    () =>
      props.selectedWorkflowId
        ? renderedRows.some((row) => row.workflow_id === props.selectedWorkflowId)
        : true,
    [props.selectedWorkflowId, renderedRows],
  );
  const shouldShowMainEmptyState = renderedRows.length === 0;

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }
    scrollRef.current.scrollTop = persistedScrollTopRef.current;
  }, [props.selectedWorkflowId, props.mode, props.ongoingOnly, renderedRows.length, selectedVisible]);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-x-hidden border-r border-border/70 bg-stone-50/90 dark:bg-slate-950/70">
      <div className="space-y-3 border-b border-border/70 px-4 py-4">
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
              onSelect={props.onSelectWorkflow}
            />
          </div>
        </section>
      ) : null}

      {props.mode === 'live' && !props.ongoingOnly && ongoingPreviewRows.length > 0 ? (
        <section className="space-y-3 border-b border-border/70 px-4 py-4">
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
                onSelect={props.onSelectWorkflow}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div
        ref={scrollRef}
        data-workflows-rail-scroll-region="true"
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3"
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
          {shouldShowMainEmptyState ? (
            <div className="px-1 py-2 text-sm text-muted-foreground">
              No workflows match the current filters.
            </div>
          ) : visibleRows.length > 0 ? (
            visibleRows.map((row) => (
              <WorkflowRailRowCard
                key={row.workflow_id}
                row={row}
                isSelected={row.workflow_id === props.selectedWorkflowId}
                onSelect={props.onSelectWorkflow}
              />
            ))
          ) : null}
          {props.hasNextPage ? (
            <Button type="button" variant="ghost" onClick={props.onLoadMore}>
              Load more
            </Button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function WorkflowRailRowCard(props: {
  row: DashboardWorkflowRailRow;
  isSelected: boolean;
  onSelect(workflowId: string): void;
}): JSX.Element {
  const primaryStatus = buildWorkflowPrimaryStatus(props.row);

  return (
    <button
      type="button"
      className={cn(
        'grid w-full min-w-0 max-w-full gap-2 rounded-xl border px-3 py-3 text-left transition-[border-color,background-color,box-shadow,color] duration-150',
        props.isSelected
          ? 'border-sky-400 bg-sky-200/90 text-sky-950 shadow-[0_12px_36px_rgba(14,165,233,0.26)] ring-1 ring-sky-300/70 dark:border-sky-300/80 dark:bg-sky-300/20 dark:text-sky-50 dark:ring-sky-300/40'
          : 'border-border/70 bg-background/85 hover:border-border hover:bg-background',
      )}
      onClick={() => props.onSelect(props.row.workflow_id)}
    >
      <div className="grid min-w-0 gap-2">
        <div className="min-w-0">
          <p className={cn('truncate text-sm font-semibold', props.isSelected ? 'text-inherit' : 'text-foreground')}>
            {props.row.name}
          </p>
          <p
            className={cn(
              'truncate text-xs',
              props.isSelected ? 'text-sky-900/85 dark:text-sky-100/85' : 'text-muted-foreground',
            )}
          >
            {[props.row.playbook_name, props.row.workspace_name].filter(Boolean).join(' • ') || 'Workflow'}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {props.row.needs_action ? <Badge variant="warning">Needs action</Badge> : null}
          {props.row.lifecycle === 'ongoing' ? <Badge variant="outline">Ongoing</Badge> : null}
        </div>
      </div>

      <div
        className={cn(
          'flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs',
          props.isSelected ? 'text-sky-900/85 dark:text-sky-100/85' : 'text-muted-foreground',
        )}
      >
        <span>{humanizePosture(props.row.posture)}</span>
        <span>{formatRelativeTimestamp(props.row.last_changed_at)}</span>
      </div>

      {primaryStatus ? (
        <p className={cn('text-sm', props.isSelected ? 'text-sky-950 dark:text-sky-50' : 'text-foreground')}>
          {primaryStatus}
        </p>
      ) : null}
    </button>
  );
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

function humanizePosture(value: string | null): string {
  if (!value) {
    return 'Workflow';
  }
  if (value === 'waiting_by_design') {
    return 'Waiting for Work';
  }
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildWorkflowPrimaryStatus(row: DashboardWorkflowRailRow): string | null {
  const counts = row.counts;
  if (counts.active_work_item_count === 0 && counts.active_task_count > 0) {
    return 'Orchestrator working';
  }
  if (shouldShowRoutingState(row)) {
    return 'Routing next step';
  }
  return null;
}

function shouldShowRoutingState(row: DashboardWorkflowRailRow): boolean {
  return row.counts.active_task_count === 0
    && (row.lifecycle === 'ongoing' || row.posture === 'waiting_by_design');
}
