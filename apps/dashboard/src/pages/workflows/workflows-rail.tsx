import { useMemo, useRef } from 'react';

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
  hasNextPage: boolean;
  isLoading: boolean;
  onModeChange(mode: WorkflowPageMode): void;
  onSearchChange(value: string): void;
  onNeedsActionOnlyChange(nextValue: boolean): void;
  onShowAllOngoing(): void;
  onSelectWorkflow(workflowId: string): void;
  onLoadMore(): void;
  onCreateWorkflow(): void;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const ongoingPreviewRows = useMemo(
    () => props.ongoingRows.slice(0, ONGOING_PREVIEW_LIMIT),
    [props.ongoingRows],
  );

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r border-border/70 bg-stone-50/90 dark:bg-slate-950/70">
      <div className="space-y-4 border-b border-border/70 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Workflows
            </p>
            <h1 className="text-lg font-semibold text-foreground">Select workflow</h1>
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
          <div className="flex items-center gap-2">
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
            <Button
              size="sm"
              type="button"
              variant={props.needsActionOnly ? 'default' : 'outline'}
              onClick={() => props.onNeedsActionOnlyChange(!props.needsActionOnly)}
            >
              Needs Action
            </Button>
          </div>
        </div>
      </div>

      {props.mode === 'live' && !props.ongoingOnly && ongoingPreviewRows.length > 0 ? (
        <section className="space-y-3 border-b border-border/70 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Ongoing</p>
              <p className="text-xs text-muted-foreground">
                Sticky workflows stay visible without taking over the rail.
              </p>
            </div>
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
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        onScroll={(event) => {
          const element = event.currentTarget;
          const nearBottom =
            element.scrollTop + element.clientHeight >= element.scrollHeight - 120;
          if (nearBottom && props.hasNextPage && !props.isLoading) {
            props.onLoadMore();
          }
        }}
      >
        <div className="grid gap-2">
          {props.rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-background/80 p-4 text-sm text-muted-foreground">
              No workflows match the current rail view.
            </div>
          ) : (
            props.rows.map((row) => (
              <WorkflowRailRowCard
                key={row.workflow_id}
                row={row}
                isSelected={row.workflow_id === props.selectedWorkflowId}
                onSelect={props.onSelectWorkflow}
              />
            ))
          )}
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
  return (
    <button
      type="button"
      className={cn(
        'grid w-full gap-2 rounded-2xl border px-3 py-3 text-left transition-colors',
        props.isSelected
          ? 'border-amber-300 bg-amber-100/90 shadow-sm dark:border-amber-500/60 dark:bg-amber-500/10'
          : 'border-border/70 bg-background/85 hover:border-border hover:bg-background',
      )}
      onClick={() => props.onSelect(props.row.workflow_id)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{props.row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[props.row.playbook_name, props.row.workspace_name].filter(Boolean).join(' • ') || 'Workflow'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {props.row.needs_action ? <Badge variant="warning">Needs action</Badge> : null}
          {props.row.lifecycle === 'ongoing' ? <Badge variant="outline">Ongoing</Badge> : null}
        </div>
      </div>

      <p className="line-clamp-2 text-sm text-foreground">{props.row.live_summary}</p>

      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>{props.row.counts.active_work_item_count} work items</span>
        <span>{props.row.counts.active_task_count} tasks</span>
        {props.row.counts.open_escalation_count > 0 ? (
          <span>{props.row.counts.open_escalation_count} escalations</span>
        ) : null}
        {props.row.counts.waiting_for_decision_count > 0 ? (
          <span>{props.row.counts.waiting_for_decision_count} approvals</span>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{humanizePosture(props.row.posture)}</span>
        <span>{formatRelativeTimestamp(props.row.last_changed_at)}</span>
      </div>
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

function humanizePosture(value: string | null): string {
  if (!value) {
    return 'Workflow';
  }
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
