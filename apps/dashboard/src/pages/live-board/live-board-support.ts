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
  lifecycle?: 'planned' | 'ongoing' | null;
  state?: string;
  metrics?: {
    total_cost_usd?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  created_at?: string;
}

export interface LiveBoardWorkerRecord {
  status: string;
  current_tasks?: number | null;
}

export interface LiveBoardTaskRecord {
  workflow_id?: string | null;
  work_item_id?: string | null;
  status?: string | null;
  state?: string | null;
  retry_count?: number | null;
  is_orchestrator_task?: boolean | null;
}

export interface LiveBoardActivationRecord {
  state: string;
  recovery_status?: string | null;
  stale_started_at?: string | null;
  redispatched_task_id?: string | null;
  event_count?: number | null;
}

export interface LiveBoardFleetSummary {
  online: number;
  busy: number;
  available: number;
  offline: number;
  assignedSteps: number;
  draining: number;
  heartbeatFailures: number;
}

type BoardStageSummary = DashboardWorkflowBoardResponse['stage_summary'][number];

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
  if (workflow.lifecycle === 'ongoing') {
    return liveStages.length > 0 ? liveStages.join(', ') : 'No live stages';
  }
  if (workflow.current_stage) {
    return workflow.current_stage;
  }
  if (liveStages.length > 0) {
    return liveStages.join(', ');
  }
  return 'No stage assigned';
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

function readCompletedStageCount(board?: DashboardWorkflowBoardResponse): {
  completedCount: number;
  totalCount: number;
} | null {
  const stageSummary = board?.stage_summary ?? [];
  if (stageSummary.length === 0) {
    return null;
  }
  return {
    completedCount: stageSummary.filter(isCompletedBoardStage).length,
    totalCount: stageSummary.length,
  };
}

function isCompletedBoardStage(stage: BoardStageSummary): boolean {
  if (stage.gate_status === 'requested' || stage.gate_status === 'awaiting_approval') {
    return false;
  }
  if (stage.is_active) {
    return false;
  }
  if (stage.status === 'completed' || stage.status === 'done') {
    return true;
  }
  return stage.completed_count > 0 && stage.open_work_item_count === 0;
}

export function describeBoardProgress(
  workflow: LiveBoardWorkflowRecord,
  board?: DashboardWorkflowBoardResponse,
): string {
  const plannedStageProgress =
    workflow.lifecycle !== 'ongoing' ? readCompletedStageCount(board) : null;
  if (plannedStageProgress && plannedStageProgress.totalCount > 0) {
    return `${plannedStageProgress.completedCount} of ${plannedStageProgress.totalCount} stages complete`;
  }
  const summary = workflow.work_item_summary;
  if (!summary || summary.total_work_items === 0) {
    return 'No work items queued';
  }
  const completedCount = summary.completed_work_item_count ?? 0;
  return `${completedCount} of ${summary.total_work_items} work items complete`;
}

export function readBoardProgressPercent(
  workflow: LiveBoardWorkflowRecord,
  board?: DashboardWorkflowBoardResponse,
): number | null {
  if (workflow.lifecycle === 'ongoing') {
    return null;
  }
  const stageProgress = readCompletedStageCount(board);
  if (stageProgress && stageProgress.totalCount > 0) {
    return Math.min(
      100,
      Math.max(0, Math.round((stageProgress.completedCount / stageProgress.totalCount) * 100)),
    );
  }
  const summary = workflow.work_item_summary;
  if (!summary || summary.total_work_items <= 0) {
    return null;
  }
  const completedCount = Math.max(0, Number(summary.completed_work_item_count ?? 0));
  return Math.min(100, Math.max(0, Math.round((completedCount / summary.total_work_items) * 100)));
}

export function describeBoardSpend(workflow: LiveBoardWorkflowRecord): string {
  const totalCostUsd = workflow.metrics?.total_cost_usd;
  if (typeof totalCostUsd !== 'number') {
    return 'No spend reported';
  }
  return `$${totalCostUsd.toFixed(2)} reported`;
}

export function describeBoardTokens(workflow: LiveBoardWorkflowRecord): string {
  const totalTokens = readWorkflowTokenCount(workflow);
  if (totalTokens <= 0) {
    return 'No token telemetry';
  }
  return `${formatCompactCount(totalTokens)} tokens`;
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

export function summarizeWorkerFleet(workers: LiveBoardWorkerRecord[]): LiveBoardFleetSummary {
  return workers.reduce<LiveBoardFleetSummary>(
    (summary, worker) => {
      const currentTasks = Math.max(0, Number(worker.current_tasks ?? 0));
      const status = readWorkerStatus(worker.status);
      if (status === 'online' || status === 'active') {
        summary.online += 1;
        summary.assignedSteps += currentTasks;
        if (currentTasks > 0) {
          summary.busy += 1;
        } else {
          summary.available += 1;
        }
        return summary;
      }
      if (status === 'busy') {
        summary.online += 1;
        summary.busy += 1;
        summary.assignedSteps += currentTasks > 0 ? currentTasks : 1;
        return summary;
      }
      if (status === 'draining') {
        summary.online += 1;
        summary.draining += 1;
        summary.assignedSteps += currentTasks;
        if (currentTasks > 0) {
          summary.busy += 1;
        }
        return summary;
      }
      if (isHeartbeatFailureStatus(status)) {
        summary.offline += 1;
        summary.heartbeatFailures += 1;
        return summary;
      }
      summary.offline += 1;
      return summary;
    },
    { online: 0, busy: 0, available: 0, offline: 0, assignedSteps: 0, draining: 0, heartbeatFailures: 0 },
  );
}

export function describeWorkerCapacity(worker: LiveBoardWorkerRecord): string {
  const currentTasks = Math.max(0, Number(worker.current_tasks ?? 0));
  const status = readWorkerStatus(worker.status);
  if (status === 'busy') {
    return `${Math.max(1, currentTasks)} step${Math.max(1, currentTasks) === 1 ? '' : 's'} active`;
  }
  if (status === 'draining') {
    return currentTasks > 0
      ? `Draining after ${currentTasks} active step${currentTasks === 1 ? '' : 's'}`
      : 'Draining';
  }
  if (isHeartbeatFailureStatus(status)) {
    return 'Heartbeat missing';
  }
  if (status !== 'online' && status !== 'active') {
    return 'Offline';
  }
  if (currentTasks > 0) {
    return `${currentTasks} step${currentTasks === 1 ? '' : 's'} active`;
  }
  return 'Available for new steps';
}

export function describeFleetHeadline(summary: LiveBoardFleetSummary): string {
  if (summary.heartbeatFailures > 0) {
    return `${summary.heartbeatFailures} worker heartbeat issue${summary.heartbeatFailures === 1 ? '' : 's'}`;
  }
  if (summary.draining > 0) {
    return `${summary.draining} worker${summary.draining === 1 ? '' : 's'} draining`;
  }
  if (summary.online === 0) {
    return 'No connected workers';
  }
  if (summary.busy > 0) {
    return `${summary.busy} worker${summary.busy === 1 ? '' : 's'} actively executing`;
  }
  return `${summary.available} worker${summary.available === 1 ? '' : 's'} ready for new steps`;
}

export function countFleetAttentionSignals(summary: Pick<LiveBoardFleetSummary, 'draining' | 'heartbeatFailures'>): number {
  return summary.draining + summary.heartbeatFailures;
}

export function describeFleetAttention(summary: LiveBoardFleetSummary): string {
  const parts: string[] = [];
  if (summary.heartbeatFailures > 0) {
    parts.push(
      `${summary.heartbeatFailures} heartbeat issue${summary.heartbeatFailures === 1 ? '' : 's'}`,
    );
  }
  if (summary.draining > 0) {
    parts.push(`${summary.draining} draining`);
  }
  return parts.length > 0 ? parts.join(' • ') : 'Fleet stable';
}

export function countEscalatedSteps(tasks: LiveBoardTaskRecord[]): number {
  return tasks.filter((task) => !task.is_orchestrator_task && readTaskState(task) === 'escalated').length;
}

export function countReworkHeavySteps(tasks: LiveBoardTaskRecord[], threshold = 2): number {
  return tasks.filter(
    (task) =>
      !task.is_orchestrator_task &&
      Number(task.retry_count ?? 0) >= threshold,
  ).length;
}

export function countWorkItemReworks(tasks: LiveBoardTaskRecord[], workItemId: string): number {
  let highestRetryCount = 0;
  for (const task of tasks) {
    if (task.is_orchestrator_task || task.work_item_id !== workItemId) {
      continue;
    }
    highestRetryCount = Math.max(highestRetryCount, Math.max(0, Number(task.retry_count ?? 0)));
  }
  return highestRetryCount;
}

export function describeWorkItemOperatorSummary(
  tasks: LiveBoardTaskRecord[],
  workItemId: string,
): string {
  const relevantTasks = tasks.filter(
    (task) => !task.is_orchestrator_task && task.work_item_id === workItemId,
  );
  if (relevantTasks.length === 0) {
    return 'No specialist steps linked yet';
  }

  let active = 0;
  let reviews = 0;
  let blocked = 0;
  let escalated = 0;
  let completed = 0;
  for (const task of relevantTasks) {
    const state = readTaskState(task);
    if (state === 'awaiting_approval' || state === 'output_pending_assessment') {
      reviews += 1;
      continue;
    }
    if (state === 'escalated' || state === 'failed') {
      escalated += 1;
      continue;
    }
    if (state === 'blocked') {
      blocked += 1;
      continue;
    }
    if (state === 'ready' || state === 'in_progress') {
      active += 1;
      continue;
    }
    if (state === 'completed') {
      completed += 1;
    }
  }

  const parts = [
    reviews > 0 ? `${reviews} review` : null,
    escalated > 0 ? `${escalated} escalated` : null,
    blocked > 0 ? `${blocked} blocked` : null,
    active > 0 ? `${active} active` : null,
    completed > 0 ? `${completed} completed` : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0
    ? parts.join(' • ')
    : `${relevantTasks.length} tracked step${relevantTasks.length === 1 ? '' : 's'}`;
}

export function countActiveSpecialistSteps(tasks: LiveBoardTaskRecord[]): number {
  return tasks.filter((task) => {
    if (task.is_orchestrator_task) {
      return false;
    }
    const state = readTaskState(task);
    return state === 'ready' || state === 'in_progress' || state === 'blocked';
  }).length;
}

export function countSpecialistReviewQueue(tasks: LiveBoardTaskRecord[]): number {
  return tasks.filter((task) => {
    if (task.is_orchestrator_task) {
      return false;
    }
    const state = readTaskState(task);
    return state === 'awaiting_approval' || state === 'output_pending_assessment';
  }).length;
}

export function summarizeActivationHealth(activations: LiveBoardActivationRecord[]) {
  return activations.reduce(
    (summary, activation) => {
      if (['processing', 'running', 'in_progress'].includes(activation.state)) {
        summary.inFlight += 1;
      }
      if (activation.recovery_status || activation.stale_started_at || activation.redispatched_task_id) {
        summary.needsAttention += 1;
      }
      if (activation.stale_started_at) {
        summary.stale += 1;
      }
      if (activation.recovery_status) {
        summary.recovered += 1;
      }
      summary.queuedEvents += Math.max(1, Number(activation.event_count ?? 1));
      return summary;
    },
    { inFlight: 0, needsAttention: 0, stale: 0, recovered: 0, queuedEvents: 0 },
  );
}

export function describeOrchestratorPool(summary: {
  inFlight: number;
  stale: number;
  recovered: number;
  queuedEvents: number;
}): string {
  if (summary.inFlight === 0 && summary.stale === 0 && summary.recovered === 0) {
    return summary.queuedEvents > 0
      ? `${summary.queuedEvents} queued event${summary.queuedEvents === 1 ? '' : 's'}`
      : 'Idle';
  }

  const parts = [`${summary.inFlight} active`];
  if (summary.stale > 0) {
    parts.push(`${summary.stale} stale`);
  }
  if (summary.recovered > 0) {
    parts.push(`${summary.recovered} recovered`);
  }
  return parts.join(' • ');
}

export function describeSpecialistPool(summary: {
  active: number;
  reviews: number;
  escalations: number;
  reworkHeavy: number;
}): string {
  if (
    summary.active === 0 &&
    summary.reviews === 0 &&
    summary.escalations === 0 &&
    summary.reworkHeavy === 0
  ) {
    return 'Quiet';
  }

  const parts = [`${summary.active} active`];
  if (summary.reviews > 0) {
    parts.push(`${summary.reviews} review`);
  }
  if (summary.escalations > 0) {
    parts.push(`${summary.escalations} escalated`);
  }
  if (summary.reworkHeavy > 0) {
    parts.push(`${summary.reworkHeavy} rework-heavy`);
  }
  return parts.join(' • ');
}

export function describeRiskPosture(summary: {
  blocked: number;
  gates: number;
  failed: number;
  escalated: number;
  reworkHeavy: number;
  staleActivations: number;
  fleetIssues: number;
}): string {
  const parts: string[] = [];
  if (summary.blocked > 0) {
    parts.push(`${summary.blocked} blocked`);
  }
  if (summary.gates > 0) {
    parts.push(`${summary.gates} gates`);
  }
  if (summary.failed > 0) {
    parts.push(`${summary.failed} failed`);
  }
  if (summary.escalated > 0) {
    parts.push(`${summary.escalated} escalated`);
  }
  if (summary.reworkHeavy > 0) {
    parts.push(`${summary.reworkHeavy} rework-heavy`);
  }
  if (summary.staleActivations > 0) {
    parts.push(`${summary.staleActivations} stale`);
  }
  if (summary.fleetIssues > 0) {
    parts.push(`${summary.fleetIssues} fleet`);
  }
  return parts.length > 0 ? parts.join(' • ') : 'Stable';
}

export function summarizeVisibleTokenUsage(workflows: LiveBoardWorkflowRecord[]): string {
  const total = workflows.reduce((sum, workflow) => sum + readWorkflowTokenCount(workflow), 0);
  if (total <= 0) {
    return 'No token telemetry';
  }
  return `${formatCompactCount(total)} tokens reported`;
}

function readWorkflowTokenCount(workflow: LiveBoardWorkflowRecord): number {
  const total = Number(workflow.metrics?.total_tokens ?? 0);
  if (total > 0) {
    return total;
  }
  return Number(workflow.metrics?.prompt_tokens ?? 0) + Number(workflow.metrics?.completion_tokens ?? 0);
}

function readTaskState(task: LiveBoardTaskRecord): string {
  return String(task.state ?? task.status ?? 'unknown').toLowerCase();
}

function readWorkerStatus(status: string | null | undefined): string {
  return String(status ?? 'unknown').toLowerCase();
}

function isHeartbeatFailureStatus(status: string): boolean {
  return (
    status === 'offline' ||
    status === 'disconnected' ||
    status === 'degraded' ||
    status === 'heartbeat_missed' ||
    status === 'missing' ||
    status === 'heartbeat_failure' ||
    status === 'stale'
  );
}

function formatCompactCount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}
