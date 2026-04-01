import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import {
  type DashboardWorkflowBoardColumn,
  type DashboardWorkflowBoardResponse,
  type DashboardWorkflowStageRecord,
  type DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import {
  buildWorkflowDetailPermalink,
  isWorkflowDetailTargetHighlighted,
} from '../../app/routes/workflow-navigation.js';
import {
  groupWorkflowWorkItems,
  type DashboardGroupedWorkItemRecord,
} from './workflow-work-item-detail-support.js';
import { Badge } from '../../components/ui/badge.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { BoardMoveControls } from './workflow-detail-board-move-controls.js';

export function PlaybookBoardCard(props: {
  workflowId: string;
  board?: DashboardWorkflowBoardResponse;
  stages: DashboardWorkflowStageRecord[];
  isLoading: boolean;
  hasError: boolean;
  selectedWorkItemId?: string | null;
  onSelectWorkItem?(workItemId: string): void;
  onBoardChanged?(): Promise<unknown> | unknown;
}) {
  const location = useLocation();
  const groupedWorkItems = groupWorkflowWorkItems(props.board?.work_items ?? []);
  const workItemsById = new Map((props.board?.work_items ?? []).map((item) => [item.id, item]));
  const milestoneGroups = groupedWorkItems.filter((item) => (item.children?.length ?? 0) > 0);
  const standaloneRoots = groupedWorkItems.filter((item) => (item.children?.length ?? 0) === 0);
  const [boardMode, setBoardMode] = useState<'grouped' | 'ungrouped'>(
    milestoneGroups.length > 0 ? 'grouped' : 'ungrouped',
  );

  useEffect(() => {
    if (milestoneGroups.length === 0 && boardMode === 'grouped') {
      setBoardMode('ungrouped');
    }
  }, [boardMode, milestoneGroups.length]);

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Work Board</CardTitle>
            <CardDescription>
              Triage directly on the board, then switch display mode when you need milestone
              grouping or a flat operator scan.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {props.selectedWorkItemId ? <Badge variant="outline">Focused detail open</Badge> : null}
            <div
              aria-label="Board view mode"
              className="inline-flex rounded-xl border border-border/70 bg-background/80 p-1"
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={boardMode === 'grouped'}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  boardMode === 'grouped'
                    ? 'bg-accent text-accent-foreground shadow-sm'
                    : 'text-muted hover:bg-border/60 hover:text-foreground',
                )}
                onClick={() => setBoardMode('grouped')}
                disabled={milestoneGroups.length === 0}
              >
                Grouped by milestone
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={boardMode === 'ungrouped'}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  boardMode === 'ungrouped'
                    ? 'bg-accent text-accent-foreground shadow-sm'
                    : 'text-muted hover:bg-border/60 hover:text-foreground',
                )}
                onClick={() => setBoardMode('ungrouped')}
              >
                Flat board
              </button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.isLoading ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
            Loading board...
          </p>
        ) : null}
        {props.hasError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            Failed to load work board.
          </p>
        ) : null}
        {props.board ? (
          <div className="grid gap-4">
            {props.board.stage_summary.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-3">
                {props.board.stage_summary.map((stage) => (
                  <article
                    key={stage.name}
                    className="grid gap-2 rounded-xl border border-border/70 bg-gradient-to-br from-border/10 via-surface to-surface p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="grid gap-1">
                        <strong>{stage.name}</strong>
                        <span className="text-xs text-muted">Stage snapshot</span>
                      </div>
                      <Badge variant="secondary">
                        {stage.completed_count}/{stage.work_item_count}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted">{stage.goal}</p>
                  </article>
                ))}
              </div>
            ) : null}
            <div
              className={
                props.selectedWorkItemId
                  ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3'
                  : 'grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
              }
            >
              {props.board.columns.map((column) => {
                const flatItems =
                  props.board?.work_items.filter((item) => item.column_id === column.id) ?? [];
                const groupedItems = [
                  ...milestoneGroups.filter((item) => item.column_id === column.id),
                  ...standaloneRoots.filter((item) => item.column_id === column.id),
                ];
                const visibleCount =
                  boardMode === 'grouped' ? groupedItems.length : flatItems.length;
                return (
                  <BoardColumnCard
                    key={column.id}
                    column={column}
                    columns={props.board.columns}
                    workflowId={props.workflowId}
                    stages={props.stages}
                    groupedItems={groupedItems}
                    flatItems={flatItems}
                    visibleCount={visibleCount}
                    boardMode={boardMode}
                    selectedWorkItemId={props.selectedWorkItemId}
                    onSelectWorkItem={props.onSelectWorkItem}
                    onBoardChanged={props.onBoardChanged}
                    workItemsById={workItemsById}
                    locationSearch={location.search}
                    locationHash={location.hash}
                  />
                );
              })}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BoardColumnCard(props: {
  column: DashboardWorkflowBoardColumn;
  columns: DashboardWorkflowBoardColumn[];
  workflowId: string;
  stages: DashboardWorkflowStageRecord[];
  groupedItems: DashboardGroupedWorkItemRecord[];
  flatItems: DashboardWorkflowWorkItemRecord[];
  visibleCount: number;
  boardMode: 'grouped' | 'ungrouped';
  selectedWorkItemId?: string | null;
  onSelectWorkItem?(workItemId: string): void;
  onBoardChanged?(): Promise<unknown> | unknown;
  workItemsById: Map<string, DashboardWorkflowWorkItemRecord>;
  locationSearch: string;
  locationHash: string;
}) {
  return (
    <Card className="border-border/70 bg-surface/90">
      <CardHeader className="gap-3 pb-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">{props.column.label}</CardTitle>
          <Badge variant="secondary">{props.visibleCount}</Badge>
        </div>
        {props.column.description ? (
          <CardDescription>{props.column.description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-3">
        {props.boardMode === 'grouped'
          ? props.groupedItems.map((item) =>
              isMilestoneRecord(item) ? (
                <MilestoneGroupCard
                  key={item.id}
                  workflowId={props.workflowId}
                  columns={props.columns}
                  stages={props.stages}
                  milestone={item}
                  selectedWorkItemId={props.selectedWorkItemId}
                  onSelectWorkItem={props.onSelectWorkItem}
                  onBoardChanged={props.onBoardChanged}
                />
              ) : (
                <BoardWorkItemCard
                  key={item.id}
                  workflowId={props.workflowId}
                  columns={props.columns}
                  stages={props.stages}
                  item={item}
                  parentTitle={
                    item.parent_work_item_id
                      ? props.workItemsById.get(item.parent_work_item_id)?.title
                      : undefined
                  }
                  selectedWorkItemId={props.selectedWorkItemId}
                  onSelectWorkItem={props.onSelectWorkItem}
                  onBoardChanged={props.onBoardChanged}
                  locationSearch={props.locationSearch}
                  locationHash={props.locationHash}
                />
              ),
            )
          : props.flatItems.map((item) => (
              <BoardWorkItemCard
                key={item.id}
                workflowId={props.workflowId}
                columns={props.columns}
                stages={props.stages}
                item={item}
                parentTitle={
                  item.parent_work_item_id
                    ? props.workItemsById.get(item.parent_work_item_id)?.title
                    : undefined
                }
                selectedWorkItemId={props.selectedWorkItemId}
                onSelectWorkItem={props.onSelectWorkItem}
                onBoardChanged={props.onBoardChanged}
                locationSearch={props.locationSearch}
                locationHash={props.locationHash}
              />
            ))}
        {props.visibleCount === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
            No work items.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MilestoneGroupCard(props: {
  workflowId: string;
  columns: DashboardWorkflowBoardColumn[];
  stages: DashboardWorkflowStageRecord[];
  milestone: DashboardGroupedWorkItemRecord;
  selectedWorkItemId?: string | null;
  onSelectWorkItem?(workItemId: string): void;
  onBoardChanged?(): Promise<unknown> | unknown;
}) {
  const completedChildren = readCompletedChildren(props.milestone);
  const totalChildren = readChildCount(props.milestone);
  const progressPercent =
    totalChildren === 0 ? 0 : Math.round((completedChildren / totalChildren) * 100);

  return (
    <article className="grid gap-3 rounded-lg border border-border/70 bg-border/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="text-left"
          aria-pressed={props.selectedWorkItemId === props.milestone.id}
          onClick={() => props.onSelectWorkItem?.(props.milestone.id)}
        >
          <strong className="text-foreground">{props.milestone.title}</strong>
        </button>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Milestone</Badge>
          <Badge variant="secondary">{progressPercent}% complete</Badge>
        </div>
      </div>
      {props.milestone.goal ? <p className="text-sm text-muted">{props.milestone.goal}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">
          {completedChildren}/{totalChildren} child items complete
        </Badge>
        <Badge variant="outline">{props.milestone.stage_name}</Badge>
        <Badge variant="outline">{props.milestone.column_id}</Badge>
      </div>
      <BoardMoveControls
        workflowId={props.workflowId}
        workItemId={props.milestone.id}
        columns={props.columns}
        stages={props.stages}
        initialColumnId={props.milestone.column_id ?? ''}
        initialStageName={props.milestone.stage_name ?? ''}
        onBoardChanged={props.onBoardChanged}
      />
      <div className="grid gap-2">
        {(props.milestone.children ?? []).map((child) => (
          <BoardWorkItemCard
            key={child.id}
            workflowId={props.workflowId}
            columns={props.columns}
            stages={props.stages}
            item={child}
            parentTitle={props.milestone.title}
            selectedWorkItemId={props.selectedWorkItemId}
            onSelectWorkItem={props.onSelectWorkItem}
            onBoardChanged={props.onBoardChanged}
            locationSearch=""
            locationHash=""
            compact
          />
        ))}
      </div>
    </article>
  );
}

function BoardWorkItemCard(props: {
  workflowId: string;
  columns: DashboardWorkflowBoardColumn[];
  stages: DashboardWorkflowStageRecord[];
  item: DashboardWorkflowWorkItemRecord | DashboardGroupedWorkItemRecord;
  parentTitle?: string;
  selectedWorkItemId?: string | null;
  onSelectWorkItem?(workItemId: string): void;
  onBoardChanged?(): Promise<unknown> | unknown;
  locationSearch: string;
  locationHash: string;
  compact?: boolean;
}) {
  return (
    <article
      id={`work-item-card-${props.item.id}`}
      className={
        props.compact
          ? 'grid gap-3 rounded-lg border border-border/70 bg-surface/80 p-3'
          : 'grid gap-3 rounded-lg border border-border/70 bg-border/10 p-4 shadow-sm'
      }
      data-selected={props.selectedWorkItemId === props.item.id ? 'true' : 'false'}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="text-left"
          aria-pressed={props.selectedWorkItemId === props.item.id}
          onClick={() => props.onSelectWorkItem?.(props.item.id)}
        >
          <strong className="text-foreground">{props.item.title}</strong>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {props.item.completed_at ? <Badge variant="success">completed</Badge> : null}
          <Link
            to={buildWorkflowDetailPermalink(props.item.workflow_id, {
              workItemId: props.item.id,
            })}
            className="text-sm text-muted underline-offset-4 hover:underline"
          >
            Permalink
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">
          {props.locationSearch &&
          isWorkflowDetailTargetHighlighted(
            props.locationSearch,
            props.locationHash,
            'work_item',
            props.item.id,
          )
            ? 'Highlighted'
            : props.item.stage_name}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{props.item.priority}</Badge>
        {props.item.owner_role ? <Badge variant="outline">{props.item.owner_role}</Badge> : null}
        {isMilestoneRecord(props.item) ? <Badge variant="outline">Milestone</Badge> : null}
        {props.parentTitle ? <Badge variant="outline">Milestone: {props.parentTitle}</Badge> : null}
        {props.item.task_count !== undefined ? (
          <Badge variant="secondary">{props.item.task_count} tasks</Badge>
        ) : null}
        {isMilestoneRecord(props.item) ? (
          <Badge variant="secondary">
            {readCompletedChildren(props.item)}/{readChildCount(props.item)} children
          </Badge>
        ) : null}
      </div>
      {props.item.goal ? <p className="text-sm text-muted">{props.item.goal}</p> : null}
      {props.item.acceptance_criteria ? (
        <p className="text-sm text-muted">Acceptance: {props.item.acceptance_criteria}</p>
      ) : null}
      {props.item.notes ? <p className="text-sm text-muted">Notes: {props.item.notes}</p> : null}
      <BoardMoveControls
        workflowId={props.workflowId}
        workItemId={props.item.id}
        columns={props.columns}
        stages={props.stages}
        initialColumnId={props.item.column_id ?? ''}
        initialStageName={props.item.stage_name ?? ''}
        onBoardChanged={props.onBoardChanged}
      />
    </article>
  );
}

function isMilestoneRecord(
  item: { children_count?: number; is_milestone?: boolean } | DashboardWorkflowWorkItemRecord,
) {
  return (item.children_count ?? 0) > 0 || item.is_milestone === true;
}

function readChildCount(
  item:
    | { children_count?: number; children?: DashboardGroupedWorkItemRecord[] }
    | DashboardWorkflowWorkItemRecord,
) {
  return item.children_count ?? item.children?.length ?? 0;
}

function readCompletedChildren(
  item:
    | {
        children_completed?: number;
        children?: DashboardGroupedWorkItemRecord[];
      }
    | DashboardWorkflowWorkItemRecord,
) {
  return item.children_completed ?? item.children?.filter((child) => child.completed_at).length ?? 0;
}
