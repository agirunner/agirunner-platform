import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import type { DashboardWorkflowBoardResponse, DashboardWorkflowWorkItemRecord } from '../../lib/api.js';
import { dashboardApi } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import type { WorkflowBoardMode } from './workflows-page.support.js';

type StageFilter = string;

interface WorkflowTaskPreview {
  id: string;
  title: string;
  role: string | null;
  state: string | null;
}

export function WorkflowBoard(props: {
  workflowId: string;
  board: DashboardWorkflowBoardResponse | null;
  selectedWorkItemId: string | null;
  boardMode: WorkflowBoardMode;
  onBoardModeChange(nextMode: WorkflowBoardMode): void;
  onSelectWorkItem(workItemId: string): void;
}): JSX.Element {
  const [stageFilter, setStageFilter] = useState<StageFilter>('__all__');
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [needsActionOnly, setNeedsActionOnly] = useState(false);

  const filteredWorkItems = useMemo(
    () =>
      filterBoardWorkItems(
        props.board,
        props.boardMode,
        stageFilter,
        blockedOnly,
        escalatedOnly,
        needsActionOnly,
      ),
    [blockedOnly, escalatedOnly, needsActionOnly, props.board, props.boardMode, stageFilter],
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

  const stageOptions = Array.from(new Set(props.board.stage_summary.map((stage) => stage.name)));
  const groupedStages = groupStages(filteredWorkItems);

  return (
    <section className="space-y-4 rounded-3xl border border-border/70 bg-background/90 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-foreground">Workflow board</p>
          <p className="text-sm text-muted-foreground">
            Work items remain primary; tasks stay visible as subordinate execution steps.
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
          {stageOptions.map((stageName) => (
            <option key={stageName} value={stageName}>
              {stageName}
            </option>
          ))}
        </select>
        <ToggleFilter label="Needs Action" isActive={needsActionOnly} onClick={() => setNeedsActionOnly((current) => !current)} />
        <ToggleFilter label="Blocked" isActive={blockedOnly} onClick={() => setBlockedOnly((current) => !current)} />
        <ToggleFilter label="Escalated" isActive={escalatedOnly} onClick={() => setEscalatedOnly((current) => !current)} />
      </div>

      <div className="grid gap-4">
        {groupedStages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
            No work items match the current board filters.
          </div>
        ) : (
          groupedStages.map((stage) => (
            <article key={stage.stageName} className="space-y-3 rounded-2xl border border-border/70 bg-muted/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{humanizeToken(stage.stageName)}</p>
                  <p className="text-xs text-muted-foreground">
                    {stage.activeItems.length} active • {stage.completedItems.length} completed
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {stage.activeItems.length > 0 ? <Badge variant="outline">{stage.activeItems.length} active</Badge> : null}
                  {stage.completedItems.length > 0 ? <Badge variant="secondary">{stage.completedItems.length} complete</Badge> : null}
                </div>
              </div>

              <div className="grid gap-3">
                {stage.activeItems.map((workItem) => (
                  <BoardWorkItemCard
                    key={workItem.id}
                    workItem={workItem}
                    tasks={tasksByWorkItem.get(workItem.id) ?? []}
                    isSelected={workItem.id === props.selectedWorkItemId}
                    onSelect={props.onSelectWorkItem}
                  />
                ))}
              </div>

              {props.boardMode !== 'active' && stage.completedItems.length > 0 ? (
                <details className="rounded-2xl border border-border/70 bg-background/70 p-3" open={props.boardMode === 'all'}>
                  <summary className="cursor-pointer text-sm font-medium text-foreground">
                    Completed work
                  </summary>
                  <div className="mt-3 grid gap-3">
                    {stage.completedItems.map((workItem) => (
                      <BoardWorkItemCard
                        key={workItem.id}
                        workItem={workItem}
                        tasks={tasksByWorkItem.get(workItem.id) ?? []}
                        isSelected={workItem.id === props.selectedWorkItemId}
                        onSelect={props.onSelectWorkItem}
                        muted
                      />
                    ))}
                  </div>
                </details>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
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
        <Badge variant="outline">{humanizeToken(props.workItem.column_id)}</Badge>
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

      <div className="grid gap-2 rounded-xl border border-border/70 bg-muted/10 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Task preview
        </p>
        {props.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No task previews available yet.</p>
        ) : (
          props.tasks.slice(0, 3).map((task) => (
            <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="truncate text-foreground">{task.title}</span>
              <span className="text-muted-foreground">
                {[task.role, task.state].filter(Boolean).join(' • ')}
              </span>
            </div>
          ))
        )}
      </div>
    </button>
  );
}

function filterBoardWorkItems(
  board: DashboardWorkflowBoardResponse | null,
  boardMode: WorkflowBoardMode,
  stageFilter: StageFilter,
  blockedOnly: boolean,
  escalatedOnly: boolean,
  needsActionOnly: boolean,
): DashboardWorkflowWorkItemRecord[] {
  if (!board) {
    return [];
  }
  const terminalColumns = new Set(board.columns.filter((column) => column.is_terminal).map((column) => column.id));
  return board.work_items.filter((workItem) => {
    const isCompleted = isCompletedWorkItem(workItem, terminalColumns);
    if (boardMode === 'active' && isCompleted) {
      return false;
    }
    if (boardMode === 'active_recent_complete' && isCompleted && !isRecentlyCompleted(workItem.completed_at)) {
      return false;
    }
    if (stageFilter !== '__all__' && workItem.stage_name !== stageFilter) {
      return false;
    }
    if (blockedOnly && workItem.blocked_state !== 'blocked') {
      return false;
    }
    if (escalatedOnly && workItem.escalation_status !== 'open') {
      return false;
    }
    if (needsActionOnly && !isNeedsActionWorkItem(workItem)) {
      return false;
    }
    return true;
  });
}

function groupStages(workItems: DashboardWorkflowWorkItemRecord[]) {
  const groups = new Map<string, { stageName: string; activeItems: DashboardWorkflowWorkItemRecord[]; completedItems: DashboardWorkflowWorkItemRecord[] }>();
  for (const workItem of workItems) {
    const current = groups.get(workItem.stage_name) ?? {
      stageName: workItem.stage_name,
      activeItems: [],
      completedItems: [],
    };
    if (workItem.completed_at) {
      current.completedItems.push(workItem);
    } else {
      current.activeItems.push(workItem);
    }
    groups.set(workItem.stage_name, current);
  }
  return Array.from(groups.values());
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

function isCompletedWorkItem(
  workItem: DashboardWorkflowWorkItemRecord,
  terminalColumns: Set<string>,
): boolean {
  return Boolean(workItem.completed_at) || terminalColumns.has(workItem.column_id);
}

function isNeedsActionWorkItem(workItem: DashboardWorkflowWorkItemRecord): boolean {
  return (
    workItem.blocked_state === 'blocked'
    || workItem.escalation_status === 'open'
    || workItem.gate_status === 'awaiting_approval'
    || workItem.gate_status === 'request_changes'
  );
}

function isRecentlyCompleted(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return false;
  }
  return Date.now() - timestamp <= 1000 * 60 * 60 * 24;
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
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
