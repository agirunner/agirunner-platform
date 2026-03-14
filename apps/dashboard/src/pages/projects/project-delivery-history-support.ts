import type { DashboardProjectTimelineEntry } from '../../lib/api.js';

interface ProjectDeliverySignalCandidate {
  priority: number;
  value: string;
}

export interface ProjectDeliveryQuestionPacket {
  label: string;
  value: string;
  detail: string;
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
  signals: string[];
}

export interface ProjectDeliveryAttentionOverview {
  summary: string;
  nextActionHref: string;
  packets: ProjectDeliveryQuestionPacket[];
}

export interface ProjectDeliveryAttentionState {
  statusLabel: string;
  attentionLabel: string;
  nextAction: string;
  primaryActionHref: string;
}

export function buildProjectDeliveryAttentionOverview(
  entries: DashboardProjectTimelineEntry[],
): ProjectDeliveryAttentionOverview {
  const sorted = sortByCreated(entries);
  const latestRun = sorted[0];
  const latestFailedRun = sorted.find((entry) => isFailureState(entry.state));
  const attentionRuns = prioritizeAttentionRuns(sorted.filter((entry) => requiresAttention(entry)));
  const inspectTarget = attentionRuns[0] ?? latestRun;

  return {
    summary: buildAttentionSummary(latestRun, inspectTarget, attentionRuns.length),
    nextActionHref: buildInspectorHref(inspectTarget),
    packets: [
      buildLatestRunPacket(latestRun),
      buildFailurePacket(latestFailedRun, latestFailedRun ? countFailures(sorted) : 0),
      buildAttentionPacket(attentionRuns),
      buildInspectPacket(inspectTarget),
    ],
  };
}

export function buildProjectDeliveryPacket(
  entry: DashboardProjectTimelineEntry,
): ProjectDeliveryPacket {
  return {
    workflowId: entry.workflow_id,
    workflowName: entry.name,
    workflowHref: entry.link || `/work/boards/${entry.workflow_id}`,
    inspectorHref: `/work/boards/${entry.workflow_id}/inspector`,
    stateLabel: humanizeState(entry.state),
    stateVariant: statusBadgeVariant(entry.state),
    createdLabel: formatRelativeTimestamp(entry.created_at),
    createdTitle: new Date(entry.created_at).toLocaleString(),
    durationLabel:
      entry.duration_seconds === undefined || entry.duration_seconds === null
        ? null
        : formatDuration(entry.duration_seconds),
    signals: buildProjectDeliverySignals(entry),
  };
}

export function buildProjectDeliveryAttentionState(
  entry: DashboardProjectTimelineEntry,
): ProjectDeliveryAttentionState {
  if (isFailureState(entry.state)) {
    return {
      statusLabel: 'Failed',
      attentionLabel: 'Needs immediate review',
      nextAction: 'Start with inspector: confirm the failing activation and affected work items.',
      primaryActionHref: buildInspectorHref(entry),
    };
  }
  if (entry.state === 'paused') {
    return {
      statusLabel: 'Paused',
      attentionLabel: 'Review blocked progress',
      nextAction: 'Open board: resolve the blocked gate or work item before resuming.',
      primaryActionHref: entry.link || `/work/boards/${entry.workflow_id}`,
    };
  }
  if (requiresAttention(entry)) {
    return {
      statusLabel: humanizeState(entry.state),
      attentionLabel: 'Monitor now',
      nextAction: 'Inspect the live run for gate pressure and the newest operator-facing event.',
      primaryActionHref: buildInspectorHref(entry),
    };
  }
  if (entry.state === 'completed') {
    return {
      statusLabel: 'Completed',
      attentionLabel: 'Delivered',
      nextAction: 'Open board: verify outputs, downstream work, and reported spend.',
      primaryActionHref: entry.link || `/work/boards/${entry.workflow_id}`,
    };
  }
  return {
    statusLabel: humanizeState(entry.state),
    attentionLabel: 'Inspect run',
    nextAction: 'Open board: review the current workflow context and recent activity.',
    primaryActionHref: entry.link || `/work/boards/${entry.workflow_id}`,
  };
}

function buildLatestRunPacket(
  latestRun: DashboardProjectTimelineEntry | undefined,
): ProjectDeliveryQuestionPacket {
  if (!latestRun) {
    return {
      label: 'What ran',
      value: 'No recent run',
      detail: 'No project delivery runs are available yet.',
    };
  }

  return {
    label: 'What ran',
    value: latestRun.name,
    detail: `${sentenceCase(humanizeState(latestRun.state))}, started ${formatRelativeTimestamp(latestRun.created_at)}.`,
  };
}

function buildFailurePacket(
  failedRun: DashboardProjectTimelineEntry | undefined,
  failureCount: number,
): ProjectDeliveryQuestionPacket {
  if (!failedRun) {
    return {
      label: 'What failed',
      value: 'Nothing failed',
      detail: 'Nothing failed in the current delivery list.',
    };
  }

  return {
    label: 'What failed',
    value: failedRun.name,
    detail: `${formatCount(failureCount, 'failed run')} needs review.`,
  };
}

function buildAttentionPacket(
  attentionRuns: DashboardProjectTimelineEntry[],
): ProjectDeliveryQuestionPacket {
  if (attentionRuns.length === 0) {
    return {
      label: 'Needs attention',
      value: 'All clear',
      detail: 'No run currently needs operator follow-up.',
    };
  }

  return {
    label: 'Needs attention',
    value: formatRunGroupValue(attentionRuns),
    detail: `${formatCount(attentionRuns.length, 'run')} still need operator follow-up.`,
  };
}

function buildInspectPacket(
  inspectTarget: DashboardProjectTimelineEntry | undefined,
): ProjectDeliveryQuestionPacket {
  if (!inspectTarget) {
    return {
      label: 'Inspect next',
      value: 'No run selected',
      detail: 'The next inspection target will appear once delivery runs exist.',
    };
  }

  return {
    label: 'Inspect next',
    value: inspectTarget.name,
    detail: describeInspectPriority(inspectTarget),
  };
}

function buildProjectDeliverySignals(entry: DashboardProjectTimelineEntry): string[] {
  return [
    buildGateSignal(entry.stage_metrics),
    buildWorkItemSignal(entry.stage_metrics),
    buildStageSignal(entry.stage_progression),
    buildAnalyticsSignal(entry.orchestrator_analytics, 'activation_count', 'activation', 3),
    buildAnalyticsSignal(entry.orchestrator_analytics, 'reworked_task_count', 'reworked step', 4),
    buildAnalyticsSignal(
      entry.orchestrator_analytics,
      'stale_detection_count',
      'stale recovery',
      5,
    ),
    buildArtifactSignal(entry.produced_artifacts),
    buildChildWorkflowSignal(entry.workflow_relations),
    buildCostSignal(entry.orchestrator_analytics),
  ]
    .filter((signal): signal is ProjectDeliverySignalCandidate => signal !== null)
    .sort((left, right) => left.priority - right.priority)
    .slice(0, 5)
    .map((signal) => signal.value);
}

function buildStageSignal(
  progression: DashboardProjectTimelineEntry['stage_progression'],
): ProjectDeliverySignalCandidate | null {
  if (!Array.isArray(progression) || progression.length === 0) {
    return null;
  }

  const completed = progression.filter(
    (stage) =>
      stage &&
      typeof stage === 'object' &&
      (stage as Record<string, unknown>).status === 'completed',
  ).length;
  return { priority: 2, value: `${completed}/${progression.length} stages done` };
}

function buildWorkItemSignal(
  metrics: DashboardProjectTimelineEntry['stage_metrics'],
): ProjectDeliverySignalCandidate | null {
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

  return {
    priority: open > 0 ? 1 : 6,
    value:
      open > 0 ? formatCount(open, 'open work item') : `${formatCount(total, 'work item')} closed`,
  };
}

function buildGateSignal(
  metrics: DashboardProjectTimelineEntry['stage_metrics'],
): ProjectDeliverySignalCandidate | null {
  const waiting = countWaitingGates(metrics);
  return waiting > 0 ? { priority: 0, value: `${formatCount(waiting, 'gate')} waiting` } : null;
}

function buildAnalyticsSignal(
  analytics: DashboardProjectTimelineEntry['orchestrator_analytics'],
  key: string,
  noun: string,
  priority: number,
): ProjectDeliverySignalCandidate | null {
  const value = readAnalyticsNumber(analytics, key);
  return value > 0 ? { priority, value: formatCount(value, noun) } : null;
}

function buildArtifactSignal(
  artifacts: DashboardProjectTimelineEntry['produced_artifacts'],
): ProjectDeliverySignalCandidate | null {
  const count = Array.isArray(artifacts) ? artifacts.length : 0;
  return count > 0 ? { priority: 7, value: formatCount(count, 'artifact') } : null;
}

function buildChildWorkflowSignal(
  relations: DashboardProjectTimelineEntry['workflow_relations'],
): ProjectDeliverySignalCandidate | null {
  const counts = relations?.child_status_counts;
  return counts && counts.total > 0
    ? {
        priority: 8,
        value: `${counts.completed}/${counts.total} child workflows complete`,
      }
    : null;
}

function buildCostSignal(
  analytics: DashboardProjectTimelineEntry['orchestrator_analytics'],
): ProjectDeliverySignalCandidate | null {
  const totalCostUsd = readAnalyticsNumber(analytics, 'total_cost_usd');
  return totalCostUsd > 0 ? { priority: 9, value: `${formatUsd(totalCostUsd)} spend` } : null;
}

function buildAttentionSummary(
  latestRun: DashboardProjectTimelineEntry | undefined,
  inspectTarget: DashboardProjectTimelineEntry | undefined,
  attentionCount: number,
): string {
  if (!latestRun) {
    return 'No project runs are available yet.';
  }
  if (!inspectTarget) {
    return `${latestRun.name} ran most recently and nothing currently needs follow-up.`;
  }
  if (isFailureState(inspectTarget.state)) {
    return `${latestRun.name} ran most recently. ${inspectTarget.name} is the next inspection target because it failed.`;
  }
  if (attentionCount > 0) {
    return `${latestRun.name} is the latest run. ${formatCount(attentionCount, 'run')} still need operator follow-up.`;
  }
  return `${latestRun.name} ran most recently and nothing else currently needs operator follow-up.`;
}

function describeInspectPriority(entry: DashboardProjectTimelineEntry): string {
  if (isFailureState(entry.state)) {
    return 'Failed runs take priority over active work.';
  }
  if (entry.state === 'paused') {
    return 'Blocked delivery needs an operator decision before work can resume.';
  }
  if (requiresAttention(entry)) {
    return 'Live delivery pressure or waiting gates need the next look.';
  }
  return 'Latest run is the next place to verify delivery outcomes.';
}

function sortByCreated(entries: DashboardProjectTimelineEntry[]): DashboardProjectTimelineEntry[] {
  return [...entries].sort(
    (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
  );
}

function prioritizeAttentionRuns(
  entries: DashboardProjectTimelineEntry[],
): DashboardProjectTimelineEntry[] {
  return [...entries].sort((left, right) => {
    const failureRank = Number(isFailureState(right.state)) - Number(isFailureState(left.state));
    if (failureRank !== 0) {
      return failureRank;
    }
    return Date.parse(right.created_at) - Date.parse(left.created_at);
  });
}

function formatRunGroupValue(entries: DashboardProjectTimelineEntry[]): string {
  if (entries.length === 0) {
    return 'All clear';
  }
  if (entries.length === 1) {
    return entries[0]?.name ?? 'All clear';
  }
  return `${entries[0]?.name ?? 'Run'} + ${entries.length - 1} more`;
}

function countFailures(entries: DashboardProjectTimelineEntry[]): number {
  return entries.filter((entry) => isFailureState(entry.state)).length;
}

function countWaitingGates(metrics: DashboardProjectTimelineEntry['stage_metrics']): number {
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
  analytics: DashboardProjectTimelineEntry['orchestrator_analytics'],
  key: string,
): number {
  const record =
    analytics && typeof analytics === 'object' ? (analytics as Record<string, unknown>) : null;
  return Number(record?.[key] ?? 0);
}

function buildInspectorHref(entry: DashboardProjectTimelineEntry | undefined): string {
  if (!entry) {
    return '#';
  }
  return `/work/boards/${entry.workflow_id}/inspector`;
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

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isFailureState(state: string): boolean {
  return state === 'failed' || state === 'error' || state === 'cancelled';
}

function requiresAttention(entry: DashboardProjectTimelineEntry): boolean {
  return (
    isFailureState(entry.state) ||
    isActiveState(entry.state) ||
    countWaitingGates(entry.stage_metrics) > 0
  );
}

function isActiveState(state: string): boolean {
  return state === 'running' || state === 'in_progress' || state === 'active';
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

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
  if (deltaMinutes < 1) {
    return 'just now';
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}
