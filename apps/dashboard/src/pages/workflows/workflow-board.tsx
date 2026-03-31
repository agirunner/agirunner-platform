import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import type { DashboardWorkflowBoardResponse } from '../../lib/api.js';
import { dashboardApi } from '../../lib/api.js';
import {
  summarizeTaskPreviewsForWorkItem,
  type WorkflowTaskPreviewSummary,
} from './workflow-board-task-preview.js';
import type { WorkflowBoardMode } from './workflows-page.support.js';
import {
  buildWorkflowBoardView,
} from './workflow-board.support.js';
import { BoardLaneCard } from './board/workflow-board-lane-card.js';
import {
  humanizeToken,
  readDesktopFitClassName,
  THEMED_SCROLL_STYLE,
  type WorkflowBoardWorkItemAction,
} from './board/workflow-board.support.js';

type StageFilter = string;
type LaneFilter = string;
const groupStages = buildWorkflowBoardView;

export function WorkflowBoard(props: {
  workflowId: string;
  board: DashboardWorkflowBoardResponse | null;
  workflowState?: string | null;
  selectedWorkItemId: string | null;
  boardMode: WorkflowBoardMode;
  taskPreviewSummaries?: Map<string, WorkflowTaskPreviewSummary>;
  onBoardModeChange(nextMode: WorkflowBoardMode): void;
  onSelectWorkItem(workItemId: string): void;
  onWorkItemAction?(input: {
    workItemId: string;
    action: WorkflowBoardWorkItemAction;
  }): void;
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
        workflowState: props.workflowState,
        stageFilter,
        laneFilter,
        blockedOnly,
        escalatedOnly,
        needsActionOnly,
      }),
    [
      blockedOnly,
      escalatedOnly,
      laneFilter,
      needsActionOnly,
      props.board,
      props.boardMode,
      props.workflowState,
      stageFilter,
    ],
  );
  const filteredWorkItems = useMemo(
    () => boardView.lanes.flatMap((lane) => [...lane.activeItems, ...lane.visibleCompletedItems]),
    [boardView],
  );
  const shouldFitSingleDesktopRow = boardView.lanes.length > 0 && boardView.lanes.length <= 4;

  const taskQueryDescriptors = props.taskPreviewSummaries
    ? []
    : filteredWorkItems.map((workItem) => ({
        queryKey: ['workflows', 'work-item-tasks', props.workflowId, workItem.id],
        queryFn: () => dashboardApi.listWorkflowWorkItemTasks(props.workflowId, workItem.id),
        staleTime: 15_000,
      }));
  const taskQueries = useQueries({
    queries: taskQueryDescriptors,
  });

  const tasksByWorkItem = useMemo(() => {
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
  }, [filteredWorkItems, props.taskPreviewSummaries, taskQueries]);

  if (!props.board) {
    return (
      <section className="rounded-2xl bg-background/90 p-4">
        <p className="text-lg font-semibold text-foreground">Workflow board</p>
        <p className="mt-2 text-sm text-muted-foreground">
          No board state is available for this workflow yet.
        </p>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-[11rem] min-w-0 flex-col overflow-hidden sm:min-h-[15rem] lg:min-h-0">
      <div className="grid gap-0">
        <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <p className="text-base font-semibold text-foreground">Workflow board</p>
            {props.workflowState === 'paused' ? (
              <Badge variant="warning">Workflow paused</Badge>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2.5">
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
            className="min-w-[11rem] flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground sm:flex-none"
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
            className="min-w-[11rem] flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground sm:flex-none"
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
          <ToggleFilter
            label="Blocked"
            isActive={blockedOnly}
            onClick={() => setBlockedOnly((current) => !current)}
          />
          <ToggleFilter
            label="Escalated"
            isActive={escalatedOnly}
            onClick={() => setEscalatedOnly((current) => !current)}
          />
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-x-auto overflow-y-auto pb-1 px-3"
        style={THEMED_SCROLL_STYLE}
      >
        <div
          className={
            shouldFitSingleDesktopRow
              ? readDesktopFitClassName(boardView.lanes.length)
              : 'grid w-max min-w-full gap-3 md:grid-flow-col md:auto-cols-[minmax(16rem,1fr)] md:items-start'
          }
        >
          {boardView.lanes.map((lane) => (
            <BoardLaneCard
              key={lane.column.id}
              lane={lane}
              boardMode={props.boardMode}
              workflowState={props.workflowState}
              selectedWorkItemId={props.selectedWorkItemId}
              onSelectWorkItem={props.onSelectWorkItem}
              onWorkItemAction={props.onWorkItemAction}
              tasksByWorkItem={tasksByWorkItem}
            />
          ))}
        </div>
      </div>

    </section>
  );
}

function ModeButton(props: { isActive: boolean; label: string; onClick(): void }): JSX.Element {
  return (
    <Button
      size="sm"
      type="button"
      variant="outline"
      className={readNeutralFilterButtonClassName(props.isActive)}
      onClick={props.onClick}
    >
      {props.label}
    </Button>
  );
}

function ToggleFilter(props: { label: string; isActive: boolean; onClick(): void }): JSX.Element {
  return (
    <Button
      size="sm"
      type="button"
      variant="outline"
      className={readNeutralFilterButtonClassName(props.isActive)}
      onClick={props.onClick}
    >
      {props.label}
    </Button>
  );
}

function readNeutralFilterButtonClassName(isActive: boolean): string {
  return isActive
    ? 'border-sky-300/80 bg-sky-100/90 text-sky-950 shadow-sm hover:bg-sky-100 dark:border-sky-400/50 dark:bg-sky-400/15 dark:text-sky-50 dark:hover:bg-sky-400/20'
    : 'border-border bg-background/80 hover:border-border hover:bg-muted/30';
}
