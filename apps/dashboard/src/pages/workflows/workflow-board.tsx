import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import type { DashboardWorkflowBoardResponse, DashboardWorkflowWorkItemRecord } from '../../lib/api.js';
import { dashboardApi } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { WorkflowBoardTaskStack, type WorkflowTaskPreview } from './workflow-board-task-stack.js';
import type { WorkflowBoardMode } from './workflows-page.support.js';
import { buildWorkflowBoardView, isNeedsActionWorkItem } from './workflow-board.support.js';

type StageFilter = string;
type LaneFilter = string;

export function WorkflowBoard(props: {
  workflowId: string;
  board: DashboardWorkflowBoardResponse | null;
  selectedWorkItemId: string | null;
  boardMode: WorkflowBoardMode;
  onBoardModeChange(nextMode: WorkflowBoardMode): void;
  onSelectWorkItem(workItemId: string): void;
}): JSX.Element {
  const [stageFilter, setStageFilter] = useState<StageFilter>('__all__');
  const [laneFilter, setLaneFilter] = useState<LaneFilter>('__all__');
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [needsActionOnly, setNeedsActionOnly] = useState(false);

  const boardView = useMemo(
    () =>
      buildWorkflowBoardView(props.board, {
        boardMode: props.boardMode,
        stageFilter,
        laneFilter,
        blockedOnly,
        escalatedOnly,
        needsActionOnly,
      }),
    [blockedOnly, escalatedOnly, laneFilter, needsActionOnly, props.board, props.boardMode, stageFilter],
  );
  const filteredWorkItems = useMemo(
    () =>
      boardView.lanes.flatMap((lane) => [...lane.activeItems, ...lane.visibleCompletedItems]),
    [boardView],
  );

  const taskQueries = useQueries({
    queries: filteredWorkItems.map((workItem) => ({
      queryKey: ['workflows', 'work-item-tasks', props.workflowId, workItem.id],
      queryFn: () => dashboardApi.listWorkflowWorkItemTasks(props.workflowId, workItem.id),
      staleTime: 15_000,
    })),
  });

  const tasksByWorkItem = useMemo(
    () =>
      new Map(
        filteredWorkItems.map((workItem, index) => [
          workItem.id,
          normalizeTaskPreviews(taskQueries[index]?.data),
        ]),
      ),
    [filteredWorkItems, taskQueries],
  );

  if (!props.board) {
    return (
      <section className="rounded-3xl border border-border/70 bg-background/90 p-5">
        <p className="text-lg font-semibold text-foreground">Workflow board</p>
        <p className="mt-2 text-sm text-muted-foreground">
          No board state is available for this workflow yet.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-3xl border border-border/70 bg-background/90 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-foreground">Workflow board</p>
          <p className="text-sm text-muted-foreground">
            Lanes show the actual workflow flow while tasks stay subordinate under each work item.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModeButton
            isActive={props.boardMode === 'active'}
            label="Active"
            onClick={() => props.onBoardModeChange('active')}
          />
          <ModeButton
            isActive={props.boardMode === 'active_recent_complete'}
            label="Active + Recent"
            onClick={() => props.onBoardModeChange('active_recent_complete')}
          />
          <ModeButton
            isActive={props.boardMode === 'all'}
            label="All"
            onClick={() => props.onBoardModeChange('all')}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          value={stageFilter}
          onChange={(event) => setStageFilter(event.target.value)}
        >
          <option value="__all__">All stages</option>
          {boardView.stageOptions.map((stageName) => (
            <option key={stageName} value={stageName}>
              {stageName}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          value={laneFilter}
          onChange={(event) => setLaneFilter(event.target.value)}
        >
          <option value="__all__">All lanes</option>
          {boardView.laneOptions.map((column) => (
            <option key={column.id} value={column.id}>
              {column.label}
            </option>
          ))}
        </select>
        <ToggleFilter
          label="Needs Action"
          isActive={needsActionOnly}
          onClick={() => setNeedsActionOnly((current) => !current)}
        />
        <ToggleFilter label="Blocked" isActive={blockedOnly} onClick={() => setBlockedOnly((current) => !current)} />
        <ToggleFilter
          label="Escalated"
          isActive={escalatedOnly}
          onClick={() => setEscalatedOnly((current) => !current)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {boardView.activeStageNames.length > 0 ? (
          boardView.activeStageNames.map((stageName) => (
            <Badge key={stageName} variant="outline">
              Active stage: {humanizeToken(stageName)}
            </Badge>
          ))
        ) : (
          <Badge variant="outline">No active stages</Badge>
        )}
        <Badge variant="secondary">{boardView.filteredCount} visible items</Badge>
        {boardView.hasFilters ? (
          <Badge variant="outline">Filtered from {boardView.totalCount} total items</Badge>
        ) : null}
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="grid gap-4 md:grid-flow-col md:auto-cols-[minmax(18rem,1fr)]">
          {boardView.lanes.map((lane) => (
            <BoardLaneCard
              key={lane.column.id}
              lane={lane}
              boardMode={props.boardMode}
              selectedWorkItemId={props.selectedWorkItemId}
              onSelectWorkItem={props.onSelectWorkItem}
              tasksByWorkItem={tasksByWorkItem}
            />
          ))}
        </div>
      </div>

      {boardView.filteredCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
          No work items match the current board filters.
        </div>
      ) : null}
    </section>
  );
}

function BoardLaneCard(props: {
  lane: ReturnType<typeof buildWorkflowBoardView>['lanes'][number];
  boardMode: WorkflowBoardMode;
  selectedWorkItemId: string | null;
  onSelectWorkItem(workItemId: string): void;
  tasksByWorkItem: Map<string, WorkflowTaskPreview[]>;
}): JSX.Element {
  const showCompletedSection =
    props.boardMode !== 'active'
    && (props.lane.visibleCompletedItems.length > 0 || props.lane.hiddenCompletedCount > 0);

  return (
    <article className="grid min-w-0 gap-3 rounded-2xl border border-border/70 bg-muted/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{props.lane.column.label}</p>
          <p className="text-xs text-muted-foreground">
            {props.lane.activeItems.length} active • {props.lane.visibleCompletedItems.length + props.lane.hiddenCompletedCount} completed
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {props.lane.column.is_blocked ? <Badge variant="warning">Blocked lane</Badge> : null}
          {props.lane.column.is_terminal ? <Badge variant="secondary">Terminal lane</Badge> : null}
          <Badge variant="outline">{props.lane.totalFilteredCount} visible</Badge>
        </div>
      </div>

      <div className="grid gap-3">
        {props.lane.activeItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
            No active work is currently visible in this lane.
          </div>
        ) : (
          props.lane.activeItems.map((workItem) => (
            <BoardWorkItemCard
              key={workItem.id}
              workItem={workItem}
              tasks={props.tasksByWorkItem.get(workItem.id) ?? []}
              isSelected={workItem.id === props.selectedWorkItemId}
              onSelect={props.onSelectWorkItem}
            />
          ))
        )}
      </div>

      {showCompletedSection ? (
        <details className="rounded-2xl border border-border/70 bg-background/70 p-3" open={props.boardMode === 'all'}>
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            {props.boardMode === 'all' ? 'Completed work' : 'Recent completions'}
            {props.lane.hiddenCompletedCount > 0 ? ` • ${props.lane.hiddenCompletedCount} older hidden` : ''}
          </summary>
          <div className="mt-3 grid gap-3">
            {props.lane.visibleCompletedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No completed work items match the current visibility window.
              </p>
            ) : (
              props.lane.visibleCompletedItems.map((workItem) => (
                <BoardWorkItemCard
                  key={workItem.id}
                  workItem={workItem}
                  tasks={props.tasksByWorkItem.get(workItem.id) ?? []}
                  isSelected={workItem.id === props.selectedWorkItemId}
                  onSelect={props.onSelectWorkItem}
                  muted
                />
              ))
            )}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function BoardWorkItemCard(props: {
  workItem: DashboardWorkflowWorkItemRecord;
  tasks: WorkflowTaskPreview[];
  isSelected: boolean;
  muted?: boolean;
  onSelect(workItemId: string): void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'grid w-full gap-3 rounded-2xl border px-4 py-4 text-left transition-colors',
        props.isSelected
          ? 'border-amber-300 bg-amber-100/90 shadow-sm dark:border-amber-500/60 dark:bg-amber-500/10'
          : props.muted
            ? 'border-border/70 bg-background/60 hover:bg-background/80'
            : 'border-border/70 bg-background/85 hover:bg-background',
      )}
      onClick={() => props.onSelect(props.workItem.id)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-foreground">{props.workItem.title}</strong>
        <Badge variant="outline">{humanizeToken(props.workItem.stage_name)}</Badge>
        <Badge variant="outline">{props.workItem.priority}</Badge>
        {props.workItem.blocked_state === 'blocked' ? <Badge variant="destructive">Blocked</Badge> : null}
        {props.workItem.escalation_status === 'open' ? <Badge variant="warning">Escalated</Badge> : null}
        {isNeedsActionWorkItem(props.workItem) ? <Badge variant="warning">Needs action</Badge> : null}
      </div>

      <p className="text-sm text-muted-foreground">
        {props.workItem.goal ?? props.workItem.acceptance_criteria ?? 'No goal published for this work item.'}
      </p>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {props.workItem.owner_role ? <span>Owner {props.workItem.owner_role}</span> : null}
        {props.workItem.next_expected_action ? <span>Next {props.workItem.next_expected_action}</span> : null}
        <span>{props.workItem.task_count ?? 0} tasks</span>
        {props.workItem.children_count ? <span>{props.workItem.children_count} child items</span> : null}
      </div>

      {props.workItem.blocked_reason || props.workItem.gate_decision_feedback ? (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
          {props.workItem.blocked_reason ?? props.workItem.gate_decision_feedback}
        </div>
      ) : null}

      <WorkflowBoardTaskStack tasks={props.tasks} />
    </button>
  );
}

function normalizeTaskPreviews(records: Record<string, unknown>[] | undefined): WorkflowTaskPreview[] {
  if (!Array.isArray(records)) {
    return [];
  }
  return records
    .flatMap((entry) => {
      const id = typeof entry.id === 'string' ? entry.id : null;
      if (!id) {
        return [];
      }
      return [
        {
          id,
          title: typeof entry.title === 'string' ? entry.title : 'Untitled task',
          role: typeof entry.role === 'string' ? entry.role : null,
          state: typeof entry.state === 'string' ? entry.state : null,
        },
      ];
    })
    .sort((left, right) => readTaskPriority(left).localeCompare(readTaskPriority(right)));
}

function readTaskPriority(task: WorkflowTaskPreview): string {
  switch (task.state) {
    case 'failed':
    case 'awaiting_approval':
    case 'in_progress':
      return '0';
    case 'claimed':
    case 'ready':
      return '1';
    default:
      return '2';
  }
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

function ToggleFilter(props: {
  label: string;
  isActive: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <Button size="sm" type="button" variant={props.isActive ? 'default' : 'outline'} onClick={props.onClick}>
      {props.label}
    </Button>
  );
}

function humanizeToken(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
