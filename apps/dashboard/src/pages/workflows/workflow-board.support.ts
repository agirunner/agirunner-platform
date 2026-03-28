import type {
  DashboardWorkflowBoardColumn,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import type { WorkflowBoardMode } from './workflows-page.support.js';

export interface WorkflowBoardViewInput {
  boardMode: WorkflowBoardMode;
  stageFilter: string;
  laneFilter: string;
  blockedOnly: boolean;
  escalatedOnly: boolean;
  needsActionOnly: boolean;
}

export interface WorkflowBoardLaneView {
  column: DashboardWorkflowBoardColumn;
  activeItems: DashboardWorkflowWorkItemRecord[];
  visibleCompletedItems: DashboardWorkflowWorkItemRecord[];
  hiddenCompletedCount: number;
  totalFilteredCount: number;
}

export interface WorkflowBoardView {
  stageOptions: string[];
  laneOptions: DashboardWorkflowBoardColumn[];
  activeStageNames: string[];
  lanes: WorkflowBoardLaneView[];
  filteredCount: number;
  totalCount: number;
  hasFilters: boolean;
}

export function buildWorkflowBoardView(
  board: DashboardWorkflowBoardResponse | null,
  input: WorkflowBoardViewInput,
): WorkflowBoardView {
  if (!board) {
    return {
      stageOptions: [],
      laneOptions: [],
      activeStageNames: [],
      lanes: [],
      filteredCount: 0,
      totalCount: 0,
      hasFilters: false,
    };
  }

  const filteredItems = board.work_items.filter((workItem) => {
    const displayColumnId = resolveDisplayColumnId(board.columns, workItem);
    if (input.stageFilter !== '__all__' && workItem.stage_name !== input.stageFilter) {
      return false;
    }
    if (input.laneFilter !== '__all__' && displayColumnId !== input.laneFilter) {
      return false;
    }
    if (input.blockedOnly && workItem.blocked_state !== 'blocked') {
      return false;
    }
    if (input.escalatedOnly && workItem.escalation_status !== 'open') {
      return false;
    }
    if (input.needsActionOnly && !isNeedsActionWorkItem(workItem)) {
      return false;
    }
    if (input.boardMode === 'active' && isCompletedWorkItem(board.columns, workItem)) {
      return false;
    }
    return true;
  });

  const filteredByColumn = new Map<string, DashboardWorkflowWorkItemRecord[]>();
  for (const workItem of filteredItems) {
    const displayColumnId = resolveDisplayColumnId(board.columns, workItem);
    const current = filteredByColumn.get(displayColumnId) ?? [];
    current.push(workItem);
    filteredByColumn.set(displayColumnId, current);
  }

  const lanes = board.columns
    .filter((column) => input.laneFilter === '__all__' || column.id === input.laneFilter)
    .map((column) => buildLaneView(column, filteredByColumn.get(column.id) ?? [], input.boardMode));

  return {
    stageOptions: Array.from(new Set(board.stage_summary.map((stage) => stage.name))),
    laneOptions: board.columns,
    activeStageNames: board.active_stages,
    lanes,
    filteredCount: filteredItems.length,
    totalCount: board.work_items.length,
    hasFilters:
      input.stageFilter !== '__all__'
      || input.laneFilter !== '__all__'
      || input.blockedOnly
      || input.escalatedOnly
      || input.needsActionOnly,
  };
}

export function isNeedsActionWorkItem(workItem: DashboardWorkflowWorkItemRecord): boolean {
  return (
    workItem.blocked_state === 'blocked'
    || workItem.escalation_status === 'open'
    || workItem.gate_status === 'awaiting_approval'
    || workItem.gate_status === 'request_changes'
  );
}

export function isCompletedWorkItem(
  columns: DashboardWorkflowBoardColumn[],
  workItem: DashboardWorkflowWorkItemRecord,
): boolean {
  if (workItem.completed_at) {
    return true;
  }
  const column = columns.find((entry) => entry.id === workItem.column_id);
  return Boolean(column?.is_terminal);
}

function resolveDisplayColumnId(
  columns: DashboardWorkflowBoardColumn[],
  workItem: DashboardWorkflowWorkItemRecord,
): string {
  if (!isNeedsActionWorkItem(workItem)) {
    return workItem.column_id;
  }
  const blockedColumnId = columns.find((column) => column.is_blocked)?.id;
  return blockedColumnId ?? workItem.column_id;
}

function buildLaneView(
  column: DashboardWorkflowBoardColumn,
  workItems: DashboardWorkflowWorkItemRecord[],
  boardMode: WorkflowBoardMode,
): WorkflowBoardLaneView {
  const activeItems = workItems.filter((workItem) => !isColumnCompletedWorkItem(column, workItem));
  const completedItems = workItems.filter((workItem) => isColumnCompletedWorkItem(column, workItem));
  const visibleCompletedItems =
    boardMode === 'all'
      ? completedItems
      : boardMode === 'active_recent_complete'
        ? completedItems.filter((workItem) => isRecentlyCompleted(workItem.completed_at))
        : [];

  return {
    column,
    activeItems,
    visibleCompletedItems,
    hiddenCompletedCount: Math.max(completedItems.length - visibleCompletedItems.length, 0),
    totalFilteredCount: workItems.length,
  };
}

function isColumnCompletedWorkItem(
  column: DashboardWorkflowBoardColumn,
  workItem: DashboardWorkflowWorkItemRecord,
): boolean {
  return Boolean(workItem.completed_at) || Boolean(column.is_terminal);
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
