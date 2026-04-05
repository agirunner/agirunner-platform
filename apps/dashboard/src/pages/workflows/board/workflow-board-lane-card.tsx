import { Badge } from '../../../components/ui/badge.js';
import { cn } from '../../../lib/utils.js';
import type { DashboardWorkflowWorkItemRecord } from '../../../lib/api.js';
import { WorkflowBoardTaskStack } from '../workflow-board-task-stack.js';
import {
  summarizeTaskPreviewsForWorkItem,
  type WorkflowTaskPreviewSummary,
} from '../workflow-board-task-preview.js';
import type { WorkflowBoardMode } from '../workflows-page.support.js';
import {
  buildWorkflowBoardActiveTaskSummary,
  buildWorkflowBoardView,
  buildWorkflowBoardWorkItemSummary,
  isCancelledWorkItem,
  isNeedsActionWorkItem,
} from '../workflow-board.support.js';
import { BoardWorkItemControlButton } from './workflow-board-controls.js';
import {
  buildTaskStatusSummary,
  emptyTaskSummary,
  humanizeToken,
  isPausedWorkflowWorkItem,
  readPinnedCompletedCount,
  readWorkItemCardControls,
  shouldShowPriorityBadge,
  THEMED_SCROLL_STYLE,
  type WorkflowBoardWorkItemAction,
} from './workflow-board.support.js';

type WorkflowBoardLane = ReturnType<typeof buildWorkflowBoardView>['lanes'][number];

export function BoardLaneCard(props: {
  lane: WorkflowBoardLane;
  boardMode: WorkflowBoardMode;
  workflowState?: string | null;
  selectedWorkItemId: string | null;
  onSelectWorkItem(workItemId: string): void;
  onWorkItemAction?(input: {
    workItemId: string;
    action: WorkflowBoardWorkItemAction;
  }): void;
  tasksByWorkItem: Map<string, WorkflowTaskPreviewSummary>;
}): JSX.Element {
  const pinnedCompletedCount = readPinnedCompletedCount(
    props.lane.column.is_terminal,
    props.boardMode,
  );
  const pinnedCompletedItems = props.lane.visibleCompletedItems.slice(0, pinnedCompletedCount);
  const overflowCompletedItems = props.lane.visibleCompletedItems.slice(pinnedCompletedCount);
  const collapsedCompletedCount =
    overflowCompletedItems.length + props.lane.hiddenCompletedCount;
  const showCompletedSection = collapsedCompletedCount > 0;
  const laneWorkItemCount =
    props.lane.activeItems.length + props.lane.visibleCompletedItems.length;

  return (
    <article className="grid min-w-0 content-start gap-2.5 rounded-lg border border-border/60 bg-muted/5 p-2.5">
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
        {props.lane.activeItems.length === 0
          ? renderLaneEmptyState('Nothing active here right now.')
          : props.lane.activeItems.map((workItem) => (
              <BoardWorkItemCard
                key={workItem.id}
                workItem={workItem}
                workflowState={props.workflowState}
                taskSummary={props.tasksByWorkItem.get(workItem.id) ?? emptyTaskSummary()}
                isSelected={workItem.id === props.selectedWorkItemId}
                onSelect={props.onSelectWorkItem}
                onWorkItemAction={props.onWorkItemAction}
                laneWorkItemCount={laneWorkItemCount}
              />
            ))}
        {pinnedCompletedItems.map((workItem) => (
          <BoardWorkItemCard
            key={workItem.id}
            workItem={workItem}
            workflowState={props.workflowState}
            taskSummary={props.tasksByWorkItem.get(workItem.id) ?? emptyTaskSummary()}
            isSelected={workItem.id === props.selectedWorkItemId}
            onSelect={props.onSelectWorkItem}
            onWorkItemAction={props.onWorkItemAction}
            laneWorkItemCount={laneWorkItemCount}
            muted
          />
        ))}
      </div>

      {showCompletedSection ? (
        <details className="rounded-lg border border-border/70 bg-background/70 p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            {props.lane.column.is_terminal ? 'Recent completions' : 'Completed work'}
            {collapsedCompletedCount > 0 ? ` • ${collapsedCompletedCount} older hidden` : ''}
          </summary>
          <div className="mt-3 grid gap-3">
            {(props.boardMode === 'active_recent_complete'
              ? overflowCompletedItems
              : props.lane.visibleCompletedItems
            ).length === 0
              ? renderLaneEmptyState(
                  'No completed work items match the current visibility window.',
                )
              : (props.boardMode === 'active_recent_complete'
                  ? overflowCompletedItems
                  : props.lane.visibleCompletedItems
                ).map((workItem) => (
                  <BoardWorkItemCard
                    key={workItem.id}
                    workItem={workItem}
                    workflowState={props.workflowState}
                    taskSummary={props.tasksByWorkItem.get(workItem.id) ?? emptyTaskSummary()}
                    isSelected={workItem.id === props.selectedWorkItemId}
                    onSelect={props.onSelectWorkItem}
                    onWorkItemAction={props.onWorkItemAction}
                    laneWorkItemCount={laneWorkItemCount}
                    muted
                  />
                ))}
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
  laneWorkItemCount: number;
  muted?: boolean;
  onSelect(workItemId: string): void;
  onWorkItemAction?(input: {
    workItemId: string;
    action: WorkflowBoardWorkItemAction;
  }): void;
}): JSX.Element {
  const isHistoricalWorkItem =
    Boolean(props.workItem.completed_at) || isCancelledWorkItem(props.workItem, props.workflowState);
  const displayTaskSummary = isHistoricalWorkItem
    ? filterHistoricalTaskSummary(props.taskSummary)
    : props.taskSummary;
  const currentStateSummary = buildWorkflowBoardWorkItemSummary(
    props.workItem,
    displayTaskSummary,
  );
  const activeTaskSummary = buildWorkflowBoardActiveTaskSummary(displayTaskSummary);
  const taskStatusSummary = buildTaskStatusSummary(displayTaskSummary);
  const workItemControls = readWorkItemCardControls(
    props.workItem,
    props.workflowState,
    Boolean(props.muted) || Boolean(props.workItem.completed_at),
  );
  const activeTaskCountSuffix =
    activeTaskSummary && activeTaskSummary.activeTaskCount > 1
      ? ` +${activeTaskSummary.activeTaskCount - 1} more active`
      : '';
  const activeTaskLabel =
    activeTaskSummary?.isOrchestratorTask === true ? 'Active task' : 'Active specialist';
  const isSelected = props.isSelected;
  const titleClassName = isSelected ? 'text-accent' : 'text-foreground';
  const summaryClassName = isSelected ? 'text-accent/90' : 'text-muted-foreground';
  const cardBodyClassName = readWorkItemCardBodyClassName(props.laneWorkItemCount);

  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-xl border transition-all',
        isSelected
          ? 'border-accent/40 bg-background/85 ring-1 ring-accent/30 shadow-md'
          : props.muted
            ? 'border-border/70 bg-background/60 hover:border-accent/20 hover:bg-background/80'
            : 'border-border/70 bg-background/85 hover:border-accent/20 hover:bg-background',
      )}
    >
      {isSelected ? (
        <div
          data-work-item-selection-edge="true"
          className="absolute inset-y-3 left-0 w-1 rounded-full bg-accent"
        />
      ) : null}
      <div
        role="button"
        tabIndex={0}
        data-work-item-card="true"
        data-selected={isSelected ? 'true' : 'false'}
        className={cardBodyClassName}
        style={THEMED_SCROLL_STYLE}
        onClick={() => props.onSelect(props.workItem.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            props.onSelect(props.workItem.id);
          }
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <strong className={titleClassName}>{props.workItem.title}</strong>
              <Badge variant="outline">{humanizeToken(props.workItem.stage_name)}</Badge>
              {shouldShowPriorityBadge(props.workItem.priority) ? (
                <Badge variant="outline">{humanizeToken(props.workItem.priority)}</Badge>
              ) : null}
              {props.workItem.blocked_state === 'blocked' ? (
                <Badge variant="destructive">Blocked</Badge>
              ) : null}
              {props.workItem.escalation_status === 'open' ? (
                <Badge variant="warning">Escalated</Badge>
              ) : null}
              {isNeedsActionWorkItem(props.workItem) ? (
                <Badge variant="warning">Needs action</Badge>
              ) : null}
              {isCancelledWorkItem(props.workItem, props.workflowState) ? (
                <Badge variant="secondary">Cancelled</Badge>
              ) : null}
              {isPausedWorkflowWorkItem(props.workItem) ? (
                <Badge variant="secondary">Paused</Badge>
              ) : null}
              {displayTaskSummary.hasActiveOrchestratorTask ? (
                <Badge variant="secondary">Orchestrator working</Badge>
              ) : null}
            </div>
          </div>
          {workItemControls.length > 0 ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {workItemControls.map((control) => (
                <BoardWorkItemControlButton
                  key={control.action}
                  workItemId={props.workItem.id}
                  control={control}
                  onAction={props.onWorkItemAction}
                />
              ))}
            </div>
          ) : null}
        </div>

        {currentStateSummary ? (
          <p className={cn('text-sm leading-6', summaryClassName)}>{currentStateSummary}</p>
        ) : null}

        {activeTaskSummary ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {activeTaskLabel}
            </span>
            {activeTaskSummary.roleLabel ? (
              <span className="font-medium text-foreground">{activeTaskSummary.roleLabel}</span>
            ) : null}
            {activeTaskSummary.taskTitle ? (
              <span className="text-muted-foreground">
                on {activeTaskSummary.taskTitle}
                {activeTaskCountSuffix}
              </span>
            ) : activeTaskCountSuffix ? (
              <span className="text-muted-foreground">{activeTaskCountSuffix.trim()}</span>
            ) : null}
          </div>
        ) : null}

        {!activeTaskSummary && taskStatusSummary ? (
          <p className="text-xs text-muted-foreground">{taskStatusSummary}</p>
        ) : null}

        {props.workItem.blocked_reason || props.workItem.gate_decision_feedback ? (
          <div className="rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
            {props.workItem.blocked_reason ?? props.workItem.gate_decision_feedback}
          </div>
        ) : null}

        {displayTaskSummary.tasks.length > 0 ? (
          <WorkflowBoardTaskStack
            tasks={displayTaskSummary.tasks}
            collapsible={!isSelected ? false : undefined}
            defaultOpen={isSelected}
            laneWorkItemCount={props.laneWorkItemCount}
            onSelectWorkItem={() => props.onSelect(props.workItem.id)}
          />
        ) : null}
      </div>
    </article>
  );
}

function readWorkItemCardBodyClassName(laneWorkItemCount: number): string {
  const boundedHeightClassName =
    laneWorkItemCount === 1 ? 'max-h-[21rem]' : 'max-h-[19rem]';
  return cn(
    'grid min-h-[7rem] gap-3 overflow-y-auto overscroll-contain px-3.5 py-3.5 pr-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset',
    boundedHeightClassName,
  );
}

function renderLaneEmptyState(message: string): JSX.Element {
  return <p className="px-1 pb-1 text-sm text-muted-foreground">{message}</p>;
}

function filterHistoricalTaskSummary(
  taskSummary: WorkflowTaskPreviewSummary,
): WorkflowTaskPreviewSummary {
  const retainedTasks = taskSummary.tasks.filter((task) => isRetainedHistoricalTask(task.state));
  return {
    hasActiveOrchestratorTask: retainedTasks.some(
      (task) => task.isOrchestratorTask === true && isActiveHistoricalTask(task.state),
    ),
    tasks: retainedTasks,
  };
}

function isRetainedHistoricalTask(state: string | null | undefined): boolean {
  return state === 'completed' || isActiveHistoricalTask(state);
}

function isActiveHistoricalTask(state: string | null | undefined): boolean {
  return (
    state === 'ready'
    || state === 'claimed'
    || state === 'in_progress'
    || state === 'awaiting_approval'
    || state === 'output_pending_assessment'
  );
}
