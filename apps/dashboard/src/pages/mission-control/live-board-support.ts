import type { DashboardWorkflowBoardResponse } from '../../lib/api.js';

export interface LiveBoardWorkflowRecord {
  name?: string;
  current_stage?: string | null;
  active_stages?: string[];
  work_item_summary?: {
    total_work_items: number;
    completed_work_item_count?: number;
    open_work_item_count: number;
    awaiting_gate_count: number;
    active_stage_names?: string[];
  } | null;
  lifecycle?: 'standard' | 'continuous' | null;
  state?: string;
  metrics?: {
    total_cost_usd?: number;
  };
  created_at?: string;
}

function readLiveStageNames(workflow: LiveBoardWorkflowRecord): string[] {
  const activeStages = workflow.active_stages?.filter((stage): stage is string => stage.trim().length > 0) ?? [];
  const summaryStages =
    workflow.work_item_summary?.active_stage_names?.filter(
      (stage): stage is string => typeof stage === 'string' && stage.trim().length > 0,
    ) ?? [];
  return Array.from(new Set([...activeStages, ...summaryStages]));
}

export function describeWorkflowStage(workflow: LiveBoardWorkflowRecord): string {
  const liveStages = readLiveStageNames(workflow);
  if (workflow.lifecycle === 'continuous') {
    return liveStages.length > 0 ? liveStages.join(', ') : '--';
  }
  if (workflow.current_stage) {
    return workflow.current_stage;
  }
  if (liveStages.length > 0) {
    return liveStages.join(', ');
  }
  return '--';
}

export function countOpenBoardItems(board?: DashboardWorkflowBoardResponse): number {
  if (!board) {
    return 0;
  }
  return board.work_items.filter((item) => {
    const column = board.columns.find((entry) => entry.id === item.column_id);
    return !column?.is_terminal;
  }).length;
}

export function countBlockedBoardItems(board?: DashboardWorkflowBoardResponse): number {
  if (!board) {
    return 0;
  }
  return board.work_items.filter((item) => {
    const column = board.columns.find((entry) => entry.id === item.column_id);
    return Boolean(column?.is_blocked);
  }).length;
}

export function resolveBoardPosture(
  workflow: LiveBoardWorkflowRecord,
  board?: DashboardWorkflowBoardResponse,
): string {
  if (countBlockedBoardItems(board) > 0) {
    return 'blocked';
  }
  if ((workflow.work_item_summary?.awaiting_gate_count ?? 0) > 0) {
    return 'awaiting gate';
  }
  if (countOpenBoardItems(board) > 0 || (workflow.work_item_summary?.open_work_item_count ?? 0) > 0) {
    return 'active';
  }
  if ((workflow.work_item_summary?.total_work_items ?? 0) > 0) {
    return 'done';
  }
  if (workflow.state === 'failed' || workflow.state === 'cancelled' || workflow.state === 'paused') {
    return 'blocked';
  }
  if (workflow.state === 'completed') {
    return 'done';
  }
  return 'planned';
}

export function describeBoardHeadline(
  workflow: LiveBoardWorkflowRecord,
  board?: DashboardWorkflowBoardResponse,
): string {
  const posture = resolveBoardPosture(workflow, board);
  const blockedCount = countBlockedBoardItems(board);
  const openCount = countOpenBoardItems(board) || (workflow.work_item_summary?.open_work_item_count ?? 0);
  const gateCount = workflow.work_item_summary?.awaiting_gate_count ?? 0;
  const totalCount = workflow.work_item_summary?.total_work_items ?? 0;

  if (posture === 'blocked' && blockedCount > 0) {
    return `${blockedCount} blocked work item${blockedCount === 1 ? '' : 's'}`;
  }
  if (posture === 'awaiting gate') {
    return `${gateCount} gate review${gateCount === 1 ? '' : 's'} waiting`;
  }
  if (posture === 'active') {
    return `${openCount} open work item${openCount === 1 ? '' : 's'}`;
  }
  if (posture === 'done' && totalCount > 0) {
    return 'All work items in terminal columns';
  }
  if (workflow.state === 'failed') {
    return 'Board execution failed';
  }
  if (workflow.state === 'cancelled') {
    return 'Board execution cancelled';
  }
  if (workflow.state === 'paused') {
    return 'Board execution paused';
  }
  return 'No work items queued';
}

export function isLiveWorkflow(workflow: LiveBoardWorkflowRecord): boolean {
  const posture = resolveBoardPosture(workflow);
  return posture === 'active' || posture === 'awaiting gate' || posture === 'blocked';
}

export function describeBoardProgress(workflow: LiveBoardWorkflowRecord): string {
  const summary = workflow.work_item_summary;
  if (!summary || summary.total_work_items === 0) {
    return 'No work items queued';
  }
  const completedCount = summary.completed_work_item_count ?? 0;
  return `${completedCount} of ${summary.total_work_items} work items complete`;
}

export function describeBoardSpend(workflow: LiveBoardWorkflowRecord): string {
  const totalCostUsd = workflow.metrics?.total_cost_usd;
  if (typeof totalCostUsd !== 'number') {
    return 'No spend reported';
  }
  return `$${totalCostUsd.toFixed(2)} reported`;
}

export function formatRelativeTimestamp(value: string | null | undefined, now = Date.now()): string {
  if (!value) {
    return 'Unknown time';
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return 'Unknown time';
  }
  const deltaMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (deltaMinutes < 1) {
    return 'Just now';
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}
