import type {
  DashboardWorkflowBoardColumn,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import type { WorkflowTaskPreviewSummary } from './workflow-board-task-preview.js';
import type { WorkflowBoardMode } from './workflows-page.support.js';

export interface WorkflowBoardViewInput {
  boardMode: WorkflowBoardMode;
  workflowState?: string | null;
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

export interface WorkflowBoardTaskCard {
  id: string;
  title: string;
  role: string | null;
  state: string | null;
  workItemId: string;
  workItemTitle: string;
  stageName: string | null;
  hasActiveOrchestratorTask: boolean;
}

export interface WorkflowBoardActiveTaskSummary {
  roleLabel: string | null;
  taskTitle: string | null;
  activeTaskCount: number;
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
    const displayColumnId = resolveDisplayColumnId(
      board.columns,
      workItem,
      input.workflowState,
    );
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
    const displayColumnId = resolveDisplayColumnId(
      board.columns,
      workItem,
      input.workflowState,
    );
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
  return workItem.escalation_status === 'open' || workItem.gate_status === 'awaiting_approval';
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

export function isCancelledWorkItem(
  workItem: DashboardWorkflowWorkItemRecord,
  workflowState?: string | null,
): boolean {
  if (workflowState !== 'cancelled') {
    return false;
  }
  return !Boolean(workItem.completed_at);
}

export function buildWorkflowBoardTaskCards(
  workItems: DashboardWorkflowWorkItemRecord[],
  taskSummaries: Map<string, WorkflowTaskPreviewSummary>,
): WorkflowBoardTaskCard[] {
  return workItems.flatMap((workItem) => {
    const summary = taskSummaries.get(workItem.id);
    if (!summary || summary.tasks.length === 0) {
      return [];
    }
    return summary.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      role: task.role,
      state: task.state,
      workItemId: workItem.id,
      workItemTitle: task.workItemTitle ?? workItem.title,
      stageName: task.stageName ?? workItem.stage_name ?? null,
      hasActiveOrchestratorTask: summary.hasActiveOrchestratorTask,
    }));
  });
}

export function buildWorkflowBoardWorkItemSummary(
  workItem: DashboardWorkflowWorkItemRecord,
  taskSummary: WorkflowTaskPreviewSummary,
): string | null {
  return (
    readPrimaryTaskSummary(taskSummary)
    ?? readNextExpectedSummary(workItem)
    ?? readSummaryText(workItem.notes)
    ?? readSummaryText(workItem.goal)
  );
}

export function buildWorkflowBoardActiveTaskSummary(
  taskSummary: WorkflowTaskPreviewSummary,
): WorkflowBoardActiveTaskSummary | null {
  const activeTasks = taskSummary.tasks.filter((task) => isActiveTaskState(task.state));
  const primaryTask = activeTasks[0];
  if (!primaryTask) {
    return null;
  }

  return {
    roleLabel: humanizeToken(primaryTask.role),
    taskTitle: readSummaryText(primaryTask.title),
    activeTaskCount: activeTasks.length,
  };
}

function resolveDisplayColumnId(
  columns: DashboardWorkflowBoardColumn[],
  workItem: DashboardWorkflowWorkItemRecord,
  workflowState?: string | null,
): string {
  if (shouldProjectToTerminalLane(workItem, workflowState)) {
    return readTerminalColumnId(columns) ?? workItem.column_id;
  }
  if (isBlockedWorkItem(workItem)) {
    return readBlockedColumnId(columns) ?? workItem.column_id;
  }
  return workItem.column_id;
}

function shouldProjectToTerminalLane(
  workItem: DashboardWorkflowWorkItemRecord,
  workflowState?: string | null,
): boolean {
  return !Boolean(workItem.completed_at) && isTerminalWorkflowState(workflowState);
}

function isTerminalWorkflowState(workflowState?: string | null): boolean {
  return workflowState === 'cancelled' || workflowState === 'completed' || workflowState === 'failed';
}

function readBlockedColumnId(columns: DashboardWorkflowBoardColumn[]): string | null {
  const blockedColumn = columns.find((column) => Boolean(column.is_blocked));
  return blockedColumn?.id ?? null;
}

function isBlockedWorkItem(workItem: DashboardWorkflowWorkItemRecord): boolean {
  return (
    workItem.blocked_state === 'blocked'
    || workItem.gate_status === 'blocked'
    || workItem.gate_status === 'request_changes'
    || workItem.gate_status === 'changes_requested'
    || workItem.gate_status === 'rejected'
  );
}

function readTerminalColumnId(columns: DashboardWorkflowBoardColumn[]): string | null {
  const terminalColumn = columns.find((column) => Boolean(column.is_terminal));
  return terminalColumn?.id ?? null;
}

function buildLaneView(
  column: DashboardWorkflowBoardColumn,
  workItems: DashboardWorkflowWorkItemRecord[],
  boardMode: WorkflowBoardMode,
): WorkflowBoardLaneView {
  const activeItems = workItems.filter((workItem) => !isColumnCompletedWorkItem(column, workItem));
  const completedItems = workItems
    .filter((workItem) => isColumnCompletedWorkItem(column, workItem))
    .sort(compareCompletedWorkItemsNewestFirst);
  const visibleCompletedItems =
    boardMode === 'all'
      ? completedItems
      : boardMode === 'active_recent_complete'
        ? completedItems.filter((workItem) => !workItem.completed_at || isRecentlyCompleted(workItem.completed_at))
        : [];

  return {
    column,
    activeItems,
    visibleCompletedItems,
    hiddenCompletedCount: Math.max(completedItems.length - visibleCompletedItems.length, 0),
    totalFilteredCount: workItems.length,
  };
}

function compareCompletedWorkItemsNewestFirst(
  left: DashboardWorkflowWorkItemRecord,
  right: DashboardWorkflowWorkItemRecord,
): number {
  return readCompletedTimestamp(right) - readCompletedTimestamp(left);
}

function readCompletedTimestamp(workItem: DashboardWorkflowWorkItemRecord): number {
  const cancelledAt = readWorkflowStopRequestedAt(workItem);
  if (!Number.isNaN(cancelledAt)) {
    return cancelledAt;
  }
  const completedAt = workItem.completed_at ? Date.parse(workItem.completed_at) : Number.NaN;
  if (!Number.isNaN(completedAt)) {
    return completedAt;
  }
  const updatedAt = 'updated_at' in workItem && typeof workItem.updated_at === 'string'
    ? Date.parse(workItem.updated_at)
    : Number.NaN;
  if (!Number.isNaN(updatedAt)) {
    return updatedAt;
  }
  return 0;
}

function readWorkflowStopRequestedAt(workItem: DashboardWorkflowWorkItemRecord): number {
  const value = workItem.metadata?.workflow_stop_requested_at;
  return typeof value === 'string' ? Date.parse(value) : Number.NaN;
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

function readPrimaryTaskSummary(taskSummary: WorkflowTaskPreviewSummary): string | null {
  const activeTasks = taskSummary.tasks.filter((task) => isActiveTaskState(task.state));
  const primaryTask = activeTasks[0] ?? taskSummary.tasks[0];
  if (!primaryTask) {
    return null;
  }
  const title = readSummaryText(primaryTask.title);
  const role = humanizeToken(primaryTask.role);
  if (activeTasks.length > 0) {
    const activeTaskSuffix = activeTasks.length > 1 ? ` (+${activeTasks.length - 1} more)` : '';
    if (role && title) {
      return `Working now: ${role} on ${title}${activeTaskSuffix}`;
    }
    if (title) {
      return `Working now: ${title}${activeTaskSuffix}`;
    }
    if (role) {
      return `Working now: ${role}${activeTaskSuffix}`;
    }
    return 'Work is in progress.';
  }
  if (role && title) {
    return `Latest task: ${role} on ${title}`;
  }
  if (title) {
    const state = humanizeToken(primaryTask.state);
    return state ? `${state}: ${title}` : title;
  }
  return role ? `Latest task: ${role}` : null;
}

function isActiveTaskState(state: string | null | undefined): boolean {
  return (
    state === 'ready' ||
    state === 'claimed' ||
    state === 'in_progress' ||
    state === 'awaiting_approval' ||
    state === 'output_pending_assessment'
  );
}

function readNextExpectedSummary(workItem: DashboardWorkflowWorkItemRecord): string | null {
  const nextActor = humanizeToken(workItem.next_expected_actor);
  const nextAction = readSummaryText(workItem.next_expected_action);
  if (nextActor && nextAction) {
    return `${nextActor} should ${lowercaseFirstCharacter(nextAction)}.`;
  }
  if (nextAction) {
    return `Next: ${nextAction}`;
  }
  if (nextActor) {
    return `${nextActor} is the next expected actor.`;
  }
  return null;
}

function readSummaryText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }
  return truncateSummary(normalized, 140);
}

function truncateSummary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function lowercaseFirstCharacter(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function humanizeToken(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
