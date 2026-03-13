import type { DashboardProjectTimelineEntry } from '../../lib/api.js';

export interface ProjectDeliveryMetric {
  label: string;
  value: string;
}

export interface ProjectDeliveryPacket {
  workflowId: string;
  workflowName: string;
  workflowHref: string;
  inspectorHref: string;
  stateLabel: string;
  stateVariant: 'success' | 'default' | 'destructive' | 'warning' | 'secondary';
  createdLabel: string;
  createdTitle: string;
  durationLabel: string | null;
  summary: string;
  metrics: ProjectDeliveryMetric[];
}

export interface ProjectDeliveryOverview {
  metrics: ProjectDeliveryMetric[];
  summary: string;
}

export function buildProjectDeliveryOverview(
  entries: DashboardProjectTimelineEntry[],
): ProjectDeliveryOverview {
  const totalRuns = entries.length;
  const activeRuns = entries.filter((entry) => isActiveState(entry.state)).length;
  const failedRuns = entries.filter((entry) => isFailureState(entry.state)).length;
  const gatedRuns = entries.filter((entry) => countWaitingGates(entry.stage_metrics) > 0).length;
  const totalCostUsd = entries.reduce(
    (total, entry) => total + readAnalyticsNumber(entry.orchestrator_analytics, 'total_cost_usd'),
    0,
  );

  return {
    metrics: [
      { label: 'Runs', value: String(totalRuns) },
      { label: 'Active', value: String(activeRuns) },
      { label: 'Failed', value: String(failedRuns) },
      { label: 'Waiting gates', value: String(gatedRuns) },
      { label: 'Reported spend', value: formatUsd(totalCostUsd) },
    ],
    summary:
      activeRuns > 0
        ? `${activeRuns} run${activeRuns === 1 ? ' still needs' : 's still need'} operator monitoring.`
        : 'No active runs are waiting for operator follow-up right now.',
  };
}

export function buildProjectDeliveryPacket(
  entry: DashboardProjectTimelineEntry,
): ProjectDeliveryPacket {
  const workflowHref = entry.link || `/work/boards/${entry.workflow_id}`;
  const inspectorHref = `/work/boards/${entry.workflow_id}/inspector`;
  const stageMetric = buildStageMetric(entry.stage_progression);
  const workItemMetric = buildWorkItemMetric(entry.stage_metrics);
  const gateMetric = buildGateMetric(entry.stage_metrics);
  const activationMetric = buildAnalyticsMetric(entry.orchestrator_analytics, 'activation_count', 'Activations');
  const reworkMetric = buildAnalyticsMetric(entry.orchestrator_analytics, 'reworked_task_count', 'Reworked steps');
  const staleMetric = buildAnalyticsMetric(entry.orchestrator_analytics, 'stale_detection_count', 'Stale recoveries');
  const artifactMetric = buildArtifactMetric(entry.produced_artifacts);
  const childWorkflowMetric = buildChildWorkflowMetric(entry.workflow_relations);
  const costMetric = buildCostMetric(entry.orchestrator_analytics);

  return {
    workflowId: entry.workflow_id,
    workflowName: entry.name,
    workflowHref,
    inspectorHref,
    stateLabel: humanizeState(entry.state),
    stateVariant: statusBadgeVariant(entry.state),
    createdLabel: formatRelativeTimestamp(entry.created_at),
    createdTitle: new Date(entry.created_at).toLocaleString(),
    durationLabel:
      entry.duration_seconds === undefined || entry.duration_seconds === null
        ? null
        : formatDuration(entry.duration_seconds),
    summary: describeProjectDeliverySummary(entry),
    metrics: [
      stageMetric,
      workItemMetric,
      gateMetric,
      activationMetric,
      reworkMetric,
      staleMetric,
      artifactMetric,
      childWorkflowMetric,
      costMetric,
    ].filter((metric): metric is ProjectDeliveryMetric => metric !== null),
  };
}

function describeProjectDeliverySummary(entry: DashboardProjectTimelineEntry): string {
  if (isFailureState(entry.state)) {
    return 'This run failed. Open the board or inspector to review the last activation, affected work items, and recovery signals.';
  }
  if (entry.state === 'paused') {
    return 'This run is paused. Review the board for waiting gates, escalations, or specialist rework before resuming.';
  }
  if (isActiveState(entry.state)) {
    return 'This run is still active. Check stage progress, gate pressure, and recent spend before intervening.';
  }
  if (entry.state === 'completed') {
    return 'This run is complete. Review delivered artifacts, reported spend, and any downstream child workflows.';
  }
  return 'Open the board for stage, gate, and work-item detail.';
}

function buildStageMetric(
  progression: DashboardProjectTimelineEntry['stage_progression'],
): ProjectDeliveryMetric | null {
  if (!Array.isArray(progression) || progression.length === 0) {
    return null;
  }
  const completed = progression.filter(
    (stage) => stage && typeof stage === 'object' && (stage as Record<string, unknown>).status === 'completed',
  ).length;
  return { label: 'Stages', value: `${completed}/${progression.length}` };
}

function buildWorkItemMetric(
  metrics: DashboardProjectTimelineEntry['stage_metrics'],
): ProjectDeliveryMetric | null {
  if (!Array.isArray(metrics) || metrics.length === 0) {
    return null;
  }

  let total = 0;
  let open = 0;
  for (const metric of metrics) {
    const counts = readWorkItemCounts(metric);
    total += Number(counts?.total ?? 0);
    open += Number(counts?.open ?? 0);
  }

  if (total <= 0) {
    return null;
  }
  return { label: 'Work items', value: `${total - open}/${total} closed` };
}

function buildGateMetric(
  metrics: DashboardProjectTimelineEntry['stage_metrics'],
): ProjectDeliveryMetric | null {
  const waiting = countWaitingGates(metrics);
  return waiting > 0 ? { label: 'Waiting gates', value: String(waiting) } : null;
}

function countWaitingGates(metrics: DashboardProjectTimelineEntry['stage_metrics']): number {
  if (!Array.isArray(metrics)) {
    return 0;
  }
  return metrics.filter(
    (metric) => metric && typeof metric === 'object' && (metric as Record<string, unknown>).gate_status === 'awaiting_approval',
  ).length;
}

function buildAnalyticsMetric(
  analytics: DashboardProjectTimelineEntry['orchestrator_analytics'],
  key: string,
  label: string,
): ProjectDeliveryMetric | null {
  const value = readAnalyticsNumber(analytics, key);
  return value > 0 ? { label, value: String(value) } : null;
}

function buildCostMetric(
  analytics: DashboardProjectTimelineEntry['orchestrator_analytics'],
): ProjectDeliveryMetric | null {
  const totalCostUsd = readAnalyticsNumber(analytics, 'total_cost_usd');
  return totalCostUsd > 0 ? { label: 'Reported spend', value: formatUsd(totalCostUsd) } : null;
}

function buildArtifactMetric(
  artifacts: DashboardProjectTimelineEntry['produced_artifacts'],
): ProjectDeliveryMetric | null {
  const count = Array.isArray(artifacts) ? artifacts.length : 0;
  return count > 0 ? { label: 'Artifacts', value: String(count) } : null;
}

function buildChildWorkflowMetric(
  relations: DashboardProjectTimelineEntry['workflow_relations'],
): ProjectDeliveryMetric | null {
  const counts = relations?.child_status_counts;
  return counts && counts.total > 0
    ? { label: 'Child workflows', value: `${counts.completed}/${counts.total} complete` }
    : null;
}

function readAnalyticsNumber(
  analytics: DashboardProjectTimelineEntry['orchestrator_analytics'],
  key: string,
): number {
  const record = analytics && typeof analytics === 'object' ? (analytics as Record<string, unknown>) : null;
  return Number(record?.[key] ?? 0);
}

function readWorkItemCounts(metric: unknown): Record<string, unknown> | null {
  if (!metric || typeof metric !== 'object') {
    return null;
  }
  const counts = (metric as Record<string, unknown>).work_item_counts;
  return counts && typeof counts === 'object' && !Array.isArray(counts)
    ? (counts as Record<string, unknown>)
    : null;
}

function statusBadgeVariant(status: string) {
  const map: Record<string, 'success' | 'default' | 'destructive' | 'warning' | 'secondary'> = {
    completed: 'success',
    running: 'default',
    in_progress: 'default',
    active: 'default',
    failed: 'destructive',
    paused: 'warning',
    pending: 'secondary',
  };
  return map[status] ?? 'secondary';
}

function humanizeState(state: string): string {
  return state.replace(/_/g, ' ');
}

function isFailureState(state: string): boolean {
  return state === 'failed' || state === 'error' || state === 'cancelled';
}

function isActiveState(state: string): boolean {
  return state === 'running' || state === 'in_progress' || state === 'active';
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatRelativeTimestamp(timestamp: string): string {
  const deltaMs = Date.now() - Date.parse(timestamp);
  const deltaMinutes = Math.round(deltaMs / 60_000);
  if (deltaMinutes < 1) return 'just now';
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}
