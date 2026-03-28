import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import type { DashboardWorkflowBoardResponse, DashboardWorkflowWorkItemRecord } from '../../lib/api.js';
import { dashboardApi } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { WorkflowBoardTaskStack } from './workflow-board-task-stack.js';
import { summarizeTaskPreviewsForWorkItem, type WorkflowTaskPreviewSummary } from './workflow-board-task-preview.js';
import type { WorkflowBoardLens, WorkflowBoardMode } from './workflows-page.support.js';
import {
  buildWorkflowBoardTaskCards,
  buildWorkflowBoardView,
  isNeedsActionWorkItem,
} from './workflow-board.support.js';

type StageFilter = string;
type LaneFilter = string;
const groupStages = buildWorkflowBoardView;

export function WorkflowBoard(props: {
  workflowId: string;
  board: DashboardWorkflowBoardResponse | null;
  workflowState?: string | null;
  selectedWorkItemId: string | null;
  selectedTaskId: string | null;
  boardLens: WorkflowBoardLens;
  boardMode: WorkflowBoardMode;
  taskPreviewSummaries?: Map<string, WorkflowTaskPreviewSummary>;
  onBoardLensChange(nextLens: WorkflowBoardLens): void;
  onBoardModeChange(nextMode: WorkflowBoardMode): void;
  onSelectWorkItem(workItemId: string): void;
  onSelectTask(workItemId: string, taskId: string): void;
}): JSX.Element {
  const [stageFilter, setStageFilter] = useState<StageFilter>('__all__');
  const [laneFilter, setLaneFilter] = useState<LaneFilter>('__all__');
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [needsActionOnly, setNeedsActionOnly] = useState(false);

  const boardView = useMemo(
    () =>
      groupStages(props.board, {
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

  const taskQueryDescriptors =
    props.taskPreviewSummaries
      ? []
      : filteredWorkItems.map((workItem) => ({
          queryKey: ['workflows', 'work-item-tasks', props.workflowId, workItem.id],
          queryFn: () => dashboardApi.listWorkflowWorkItemTasks(props.workflowId, workItem.id),
          staleTime: 15_000,
        }));
  const taskQueries = useQueries({
    queries: taskQueryDescriptors,
  });

  const tasksByWorkItem = useMemo(
    () => {
      if (props.taskPreviewSummaries) {
        return props.taskPreviewSummaries;
      }
      return new Map(
        filteredWorkItems.map((workItem, index) => [
          workItem.id,
          summarizeTaskPreviewsForWorkItem(taskQueries[index]?.data, workItem.id, {
            workItemTitle: workItem.title,
            stageName: workItem.stage_name,
          }),
        ]),
      );
    },
    [filteredWorkItems, props.taskPreviewSummaries, taskQueries],
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
    <section className="flex h-full min-h-0 flex-col gap-2">
      <div className="grid gap-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <p className="text-base font-semibold text-foreground">Workflow board</p>
            {props.workflowState === 'paused' ? <Badge variant="warning">Workflow paused</Badge> : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 pb-1">
          <ModeButton
            isActive={props.boardLens === 'work_items'}
            label="Work items"
            onClick={() => props.onBoardLensChange('work_items')}
          />
          <ModeButton
            isActive={props.boardLens === 'tasks'}
            label="Tasks"
            onClick={() => props.onBoardLensChange('tasks')}
          />
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
          <select
            className="shrink-0 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            value={stageFilter}
            onChange={(event) => setStageFilter(event.target.value)}
          >
            <option value="__all__">All stages</option>
            {boardView.stageOptions.map((stageName) => (
              <option key={stageName} value={stageName}>
                {humanizeToken(stageName)}
              </option>
            ))}
          </select>
          <select
            className="shrink-0 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
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
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto pb-1">
        <div className="grid min-h-full gap-3 md:grid-flow-col md:auto-cols-[minmax(17.5rem,1fr)]">
          {boardView.lanes.map((lane) => (
            <BoardLaneCard
              key={lane.column.id}
              lane={lane}
              boardLens={props.boardLens}
              boardMode={props.boardMode}
              workflowState={props.workflowState}
              selectedWorkItemId={props.selectedWorkItemId}
              selectedTaskId={props.selectedTaskId}
              onSelectWorkItem={props.onSelectWorkItem}
              onSelectTask={props.onSelectTask}
              tasksByWorkItem={tasksByWorkItem}
            />
          ))}
        </div>
      </div>

      {boardView.filteredCount === 0 ? (
        <div className="px-1 py-2 text-sm text-muted-foreground">
          No work items match the current board filters.
        </div>
      ) : null}
    </section>
  );
}

function BoardLaneCard(props: {
  lane: ReturnType<typeof buildWorkflowBoardView>['lanes'][number];
  boardLens: WorkflowBoardLens;
  boardMode: WorkflowBoardMode;
  workflowState?: string | null;
  selectedWorkItemId: string | null;
  selectedTaskId: string | null;
  onSelectWorkItem(workItemId: string): void;
  onSelectTask(workItemId: string, taskId: string): void;
  tasksByWorkItem: Map<string, WorkflowTaskPreviewSummary>;
}): JSX.Element {
  const activeTaskCards = useMemo(
    () => buildWorkflowBoardTaskCards(props.lane.activeItems, props.tasksByWorkItem),
    [props.lane.activeItems, props.tasksByWorkItem],
  );
  const completedTaskCards = useMemo(
    () => buildWorkflowBoardTaskCards(props.lane.visibleCompletedItems, props.tasksByWorkItem),
    [props.lane.visibleCompletedItems, props.tasksByWorkItem],
  );
  const showCompletedSection =
    props.boardMode !== 'active'
    && (props.lane.visibleCompletedItems.length > 0 || props.lane.hiddenCompletedCount > 0);

  return (
    <article className="grid h-full min-w-0 content-start gap-2.5 rounded-lg border border-border/60 bg-muted/5 p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{props.lane.column.label}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {props.lane.column.is_blocked ? <Badge variant="warning">Blocked lane</Badge> : null}
          {props.lane.column.is_terminal ? <Badge variant="secondary">Terminal lane</Badge> : null}
        </div>
      </div>

      <div className="grid gap-3">
        {props.boardLens === 'tasks'
          ? renderTaskLaneCards(activeTaskCards, props.selectedTaskId, props.onSelectTask)
          : props.lane.activeItems.length === 0 ? (
          <p className="px-1 py-1 text-sm text-muted-foreground">Nothing active here right now.</p>
        ) : (
          props.lane.activeItems.map((workItem) => (
            <BoardWorkItemCard
              key={workItem.id}
              workItem={workItem}
              workflowState={props.workflowState}
              taskSummary={props.tasksByWorkItem.get(workItem.id) ?? emptyTaskSummary()}
              isSelected={workItem.id === props.selectedWorkItemId}
              selectedTaskId={props.selectedTaskId}
              onSelect={props.onSelectWorkItem}
              />
            ))
          )}
      </div>

      {showCompletedSection ? (
        <details className="rounded-lg border border-border/70 bg-background/70 p-3" open={props.boardMode === 'all'}>
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            {props.boardMode === 'all' ? 'Completed work' : 'Recent completions'}
            {props.lane.hiddenCompletedCount > 0 ? ` • ${props.lane.hiddenCompletedCount} older hidden` : ''}
          </summary>
          <div className="mt-3 grid gap-3">
            {props.boardLens === 'tasks'
              ? renderTaskLaneCards(
                  completedTaskCards,
                  props.selectedTaskId,
                  props.onSelectTask,
                  'No completed specialist tasks match the current visibility window.',
                )
              : props.lane.visibleCompletedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No completed work items match the current visibility window.
              </p>
            ) : (
              props.lane.visibleCompletedItems.map((workItem) => (
                <BoardWorkItemCard
                  key={workItem.id}
                  workItem={workItem}
                  workflowState={props.workflowState}
                  taskSummary={props.tasksByWorkItem.get(workItem.id) ?? emptyTaskSummary()}
                  isSelected={workItem.id === props.selectedWorkItemId}
                  selectedTaskId={props.selectedTaskId}
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
  workflowState?: string | null;
  taskSummary: WorkflowTaskPreviewSummary;
  isSelected: boolean;
  selectedTaskId: string | null;
  muted?: boolean;
  onSelect(workItemId: string): void;
  onSelectTask?(workItemId: string, taskId: string): void;
}): JSX.Element {
  return (
    <article
      className={cn(
        'grid w-full gap-3 rounded-xl border px-3.5 py-3.5 text-left transition-colors',
        props.isSelected
          ? 'border-amber-300 bg-amber-100/90 shadow-sm dark:border-amber-500/60 dark:bg-amber-500/10'
          : props.muted
            ? 'border-border/70 bg-background/60 hover:bg-background/80'
            : 'border-border/70 bg-background/85 hover:bg-background',
      )}
    >
      <button type="button" className="grid w-full gap-3 text-left" onClick={() => props.onSelect(props.workItem.id)}>
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-foreground">{props.workItem.title}</strong>
          <Badge variant="outline">{humanizeToken(props.workItem.stage_name)}</Badge>
          {shouldShowPriorityBadge(props.workItem.priority) ? (
            <Badge variant="outline">{humanizeToken(props.workItem.priority)}</Badge>
          ) : null}
          {props.workItem.blocked_state === 'blocked' ? <Badge variant="destructive">Blocked</Badge> : null}
          {props.workItem.escalation_status === 'open' ? <Badge variant="warning">Escalated</Badge> : null}
          {isNeedsActionWorkItem(props.workItem) ? <Badge variant="warning">Needs action</Badge> : null}
          {isPausedWorkflowWorkItem(props.workflowState, props.workItem.completed_at) ? (
            <Badge variant="secondary">Paused</Badge>
          ) : null}
          {props.taskSummary.hasActiveOrchestratorTask ? <Badge variant="secondary">Orchestrator working</Badge> : null}
        </div>

        {props.workItem.blocked_reason || props.workItem.gate_decision_feedback ? (
          <div className="rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
            {props.workItem.blocked_reason ?? props.workItem.gate_decision_feedback}
          </div>
        ) : null}
      </button>

      <WorkflowBoardTaskStack
        tasks={props.taskSummary.tasks}
        selectedTaskId={props.selectedTaskId}
        defaultOpen={!props.muted}
        onSelectTask={
          props.onSelectTask
            ? (taskId) => props.onSelectTask?.(props.workItem.id, taskId)
            : undefined
        }
      />
      <span className="sr-only">Task preview</span>
    </article>
  );
}

function renderTaskLaneCards(
  taskCards: ReturnType<typeof buildWorkflowBoardTaskCards>,
  selectedTaskId: string | null,
  onSelectTask: (workItemId: string, taskId: string) => void,
  emptyMessage = 'No specialist tasks in this lane.',
): JSX.Element {
  if (taskCards.length === 0) {
    return (
      <p className="px-1 py-1 text-sm text-muted-foreground">{emptyMessage}</p>
    );
  }

  return (
    <>
      {groupTaskCardsByWorkItem(taskCards).map((group) => (
        <section key={group.workItemId} className="grid gap-2 rounded-xl border border-border/60 bg-background/60 p-3">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <strong className="truncate text-sm text-foreground">{group.workItemTitle}</strong>
            {group.stageName ? <Badge variant="outline">{humanizeToken(group.stageName)}</Badge> : null}
          </div>
          <div className="grid gap-2">
            {group.tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                data-task-selectable="true"
                className={cn(
                  'grid gap-2 rounded-xl border px-3 py-3 text-left transition-colors',
                  selectedTaskId === task.id
                    ? 'border-amber-300 bg-amber-100/90 shadow-sm dark:border-amber-500/60 dark:bg-amber-500/10'
                    : 'border-border/70 bg-background/85 hover:bg-background',
                )}
                onClick={() => onSelectTask(task.workItemId, task.id)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-foreground">{task.title}</strong>
                  {task.role ? <Badge variant="outline">{humanizeToken(task.role)}</Badge> : null}
                  {task.state ? <Badge variant="secondary">{humanizeToken(task.state)}</Badge> : null}
                  {task.hasActiveOrchestratorTask ? <Badge variant="secondary">Orchestrator working</Badge> : null}
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function groupTaskCardsByWorkItem(
  taskCards: ReturnType<typeof buildWorkflowBoardTaskCards>,
): Array<{
  workItemId: string;
  workItemTitle: string;
  stageName: string | null;
  tasks: typeof taskCards;
}> {
  const groups = new Map<string, {
    workItemId: string;
    workItemTitle: string;
    stageName: string | null;
    tasks: typeof taskCards;
  }>();

  for (const task of taskCards) {
    const existing = groups.get(task.workItemId);
    if (existing) {
      existing.tasks.push(task);
      continue;
    }
    groups.set(task.workItemId, {
      workItemId: task.workItemId,
      workItemTitle: task.workItemTitle,
      stageName: task.stageName ?? null,
      tasks: [task],
    });
  }

  return Array.from(groups.values());
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

function shouldShowPriorityBadge(priority: string | null | undefined): boolean {
  if (!priority) {
    return false;
  }
  const normalized = priority.trim().toLowerCase();
  return normalized !== 'medium' && normalized !== 'normal';
}

function emptyTaskSummary(): WorkflowTaskPreviewSummary {
  return {
    tasks: [],
    hasActiveOrchestratorTask: false,
  };
}

function isPausedWorkflowWorkItem(
  workflowState: string | null | undefined,
  completedAt: string | null | undefined,
): boolean {
  return workflowState === 'paused' && !completedAt;
}
