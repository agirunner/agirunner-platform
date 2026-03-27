import type { DashboardWorkspaceTimelineEntry } from '../../lib/api.js';
import { buildWorkflowDiagnosticsHref } from '../mission-control/mission-control-page.support.js';
import { buildWorkflowDetailPermalink } from './workflow-detail-permalinks.js';

export interface WorkflowWorkspaceTimelineMetric {
  label: string;
  value: string;
}

export interface WorkflowWorkspaceTimelineOverview {
  metrics: WorkflowWorkspaceTimelineMetric[];
  summary: string;
}

export interface WorkflowWorkspaceTimelinePacket {
  workflowId: string;
  workflowName: string;
  workflowHref: string;
  inspectorHref: string;
  stateLabel: string;
  summary: string;
  nextAction: string;
  createdLabel: string;
  createdTitle: string;
  completedLabel: string;
  metrics: WorkflowWorkspaceTimelineMetric[];
}

export function buildWorkflowWorkspaceTimelineOverview(
  entries: DashboardWorkspaceTimelineEntry[],
): WorkflowWorkspaceTimelineOverview {
  const activeRuns = entries.filter((entry) => isActiveState(entry.state)).length;
  const failedRuns = entries.filter((entry) => isFailureState(entry.state)).length;
  const waitingGates = entries.reduce(
    (total, entry) => total + countWaitingGates(entry.stage_metrics),
    0,
  );
  const reportedSpend = entries.reduce(
    (total, entry) => total + readAnalyticsNumber(entry.orchestrator_analytics, 'total_cost_usd'),
    0,
  );

  return {
    metrics: [
      { label: 'Runs in view', value: String(entries.length) },
      { label: 'Active', value: String(activeRuns) },
      { label: 'Failed', value: String(failedRuns) },
      { label: 'Waiting gates', value: String(waitingGates) },
      { label: 'Reported spend', value: formatUsd(reportedSpend) },
    ],
    summary:
      activeRuns > 0
        ? `${activeRuns} linked run${activeRuns === 1 ? ' still needs' : 's still need'} operator monitoring.`
        : 'No linked runs currently need live operator follow-up.',
  };
}

export function buildWorkflowWorkspaceTimelinePacket(
  entry: DashboardWorkspaceTimelineEntry,
): WorkflowWorkspaceTimelinePacket {
  return {
    workflowId: entry.workflow_id,
    workflowName: entry.name,
    workflowHref: buildWorkflowDetailPermalink(entry.workflow_id, {}),
    inspectorHref: buildWorkflowDiagnosticsHref({
      workflowId: entry.workflow_id,
      view: 'summary',
    }),
    stateLabel: humanizeState(entry.state),
    summary: describePacketSummary(entry),
    nextAction: describeNextAction(entry),
    createdLabel: formatRelativeTimestamp(entry.created_at),
    createdTitle: new Date(entry.created_at).toLocaleString(),
    completedLabel: describeCompletedLabel(entry),
    metrics: [
      buildStageMetric(entry.stage_progression),
      buildWorkItemMetric(entry.stage_metrics),
      buildGateMetric(entry.stage_metrics),
      buildActivationMetric(entry.orchestrator_analytics),
      buildArtifactMetric(entry.produced_artifacts),
      buildCostMetric(entry.orchestrator_analytics),
      buildChildWorkflowMetric(entry.workflow_relations),
    ].filter((metric): metric is WorkflowWorkspaceTimelineMetric => metric !== null),
  };
}

function describePacketSummary(entry: DashboardWorkspaceTimelineEntry): string {
  if (isFailureState(entry.state)) {
    return 'This linked run failed. Review the board or inspector for the last activation, affected work items, and recovery path.';
  }
  if (entry.state === 'paused') {
    return 'This linked run is paused. Check waiting gates, escalations, or blocked work before resuming.';
  }
  if (isActiveState(entry.state)) {
    return 'This linked run is still active. Review progress, gate pressure, and spend before intervening.';
  }
  if (entry.state === 'completed') {
    return 'This linked run is complete. Review delivered artifacts, reported spend, and downstream lineage.';
  }
  return 'Open the linked board for the current stage, work-item, and gate posture.';
}

function describeNextAction(entry: DashboardWorkspaceTimelineEntry): string {
  if (isFailureState(entry.state)) {
    return 'Open the inspector first to identify the failing activation or specialist step before retrying downstream work.';
  }
  if (countWaitingGates(entry.stage_metrics) > 0) {
    return 'Review waiting gates before treating the lineage as clear.';
  }
  if (isActiveState(entry.state)) {
    return 'Use the board for live posture and the inspector for trace depth if you see stale or costly activity.';
  }
  return 'Use the board and inspector links below if you need more run detail.';
}

function describeCompletedLabel(entry: DashboardWorkspaceTimelineEntry): string {
  if (!entry.completed_at) {
    return 'Still in progress';
  }
  return `Completed ${new Date(entry.completed_at).toLocaleString()}`;
}

function buildStageMetric(
  progression: DashboardWorkspaceTimelineEntry['stage_progression'],
): WorkflowWorkspaceTimelineMetric | null {
  if (!Array.isArray(progression) || progression.length === 0) {
    return null;
  }
  const completed = progression.filter(
    (stage) =>
      stage &&
      typeof stage === 'object' &&
      (stage as Record<string, unknown>).status === 'completed',
  ).length;
  return { label: 'Stages', value: `${completed}/${progression.length}` };
}

function buildWorkItemMetric(
  metrics: DashboardWorkspaceTimelineEntry['stage_metrics'],
): WorkflowWorkspaceTimelineMetric | null {
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
  metrics: DashboardWorkspaceTimelineEntry['stage_metrics'],
): WorkflowWorkspaceTimelineMetric | null {
  const waiting = countWaitingGates(metrics);
  return waiting > 0 ? { label: 'Waiting gates', value: String(waiting) } : null;
}

function buildActivationMetric(
  analytics: DashboardWorkspaceTimelineEntry['orchestrator_analytics'],
): WorkflowWorkspaceTimelineMetric | null {
  const value = readAnalyticsNumber(analytics, 'activation_count');
  return value > 0 ? { label: 'Activations', value: String(value) } : null;
}

function buildArtifactMetric(
  artifacts: DashboardWorkspaceTimelineEntry['produced_artifacts'],
): WorkflowWorkspaceTimelineMetric | null {
  const count = Array.isArray(artifacts) ? artifacts.length : 0;
  return count > 0 ? { label: 'Artifacts', value: String(count) } : null;
}

function buildCostMetric(
  analytics: DashboardWorkspaceTimelineEntry['orchestrator_analytics'],
): WorkflowWorkspaceTimelineMetric | null {
  const totalCostUsd = readAnalyticsNumber(analytics, 'total_cost_usd');
  return totalCostUsd > 0 ? { label: 'Reported spend', value: formatUsd(totalCostUsd) } : null;
}

function buildChildWorkflowMetric(
  relations: DashboardWorkspaceTimelineEntry['workflow_relations'],
): WorkflowWorkspaceTimelineMetric | null {
  const counts = relations?.child_status_counts;
  return counts && counts.total > 0
    ? { label: 'Child workflows', value: `${counts.completed}/${counts.total} complete` }
    : null;
}

function countWaitingGates(metrics: DashboardWorkspaceTimelineEntry['stage_metrics']): number {
  if (!Array.isArray(metrics)) {
    return 0;
  }
  return metrics.filter(
    (metric) =>
      metric &&
      typeof metric === 'object' &&
      (metric as Record<string, unknown>).gate_status === 'awaiting_approval',
  ).length;
}

function readAnalyticsNumber(
  analytics: DashboardWorkspaceTimelineEntry['orchestrator_analytics'],
  key: string,
): number {
  const record =
    analytics && typeof analytics === 'object'
      ? (analytics as Record<string, unknown>)
      : null;
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

function humanizeState(state: string): string {
  return state.replaceAll('_', ' ');
}

function isFailureState(state: string): boolean {
  return state === 'failed' || state === 'error' || state === 'cancelled';
}

function isActiveState(state: string): boolean {
  return state === 'running' || state === 'in_progress' || state === 'active';
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
