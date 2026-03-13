import type { LogOperationRecord, LogStatsResponse } from '../../lib/api.js';
import type { InspectorFilters } from '../../components/execution-inspector-support.js';
import {
  describeExecutionOperationLabel,
  formatCost,
  formatDuration,
  formatNumber,
  shortId,
} from '../../components/execution-inspector-support.js';

export interface InspectorOverviewCard {
  title: string;
  value: string;
  detail: string;
}

export function buildInspectorOverviewCards(
  filters: InspectorFilters,
  scopedWorkflowId: string,
  stats?: LogStatsResponse,
  operations: LogOperationRecord[] = [],
): InspectorOverviewCard[] {
  const totals = stats?.data.totals;

  return [
    {
      title: 'Focus',
      value: describeInspectorFocus(filters, scopedWorkflowId),
      detail: `${describeTimeWindow(filters.timeWindowHours)} window • ${describeLevelScope(filters.level)}`,
    },
    {
      title: 'Attention',
      value: describeAttentionValue(totals?.error_count ?? 0),
      detail: describeAttentionDetail(totals?.count ?? 0, totals?.error_count ?? 0, operations),
    },
    {
      title: 'Spend signal',
      value: formatCost(sumCost(stats)),
      detail: `${formatDuration(totals?.total_duration_ms ?? 0)} recorded runtime`,
    },
  ];
}

function describeInspectorFocus(filters: InspectorFilters, scopedWorkflowId: string): string {
  if (filters.taskId) {
    return `Step ${shortId(filters.taskId)}`;
  }
  if (filters.workItemId) {
    return `Work item ${shortId(filters.workItemId)}`;
  }
  if (filters.activationId) {
    return `Activation ${shortId(filters.activationId)}`;
  }
  if (filters.stageName) {
    return `Stage ${filters.stageName}`;
  }
  if (filters.workflowId) {
    return `Board ${shortId(filters.workflowId)}`;
  }
  if (scopedWorkflowId) {
    return `Board ${shortId(scopedWorkflowId)}`;
  }
  return 'All execution';
}

function describeTimeWindow(timeWindowHours: string): string {
  const hours = Number(timeWindowHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return 'Recent';
  }
  if (hours < 24) {
    return `${formatNumber(hours)}h`;
  }
  const days = hours / 24;
  return Number.isInteger(days) ? `${formatNumber(days)}d` : `${formatNumber(hours)}h`;
}

function describeLevelScope(level: string): string {
  switch (level) {
    case 'debug':
      return 'all records';
    case 'warn':
      return 'warnings and errors';
    case 'error':
      return 'errors only';
    case 'info':
    default:
      return 'info and above';
  }
}

function describeAttentionValue(errorCount: number): string {
  if (errorCount > 0) {
    return `${formatNumber(errorCount)} errors`;
  }
  return 'Healthy slice';
}

function describeAttentionDetail(
  totalCount: number,
  errorCount: number,
  operations: LogOperationRecord[],
): string {
  if (errorCount > 0) {
    const ratio = totalCount > 0 ? Math.round((errorCount / totalCount) * 100) : 0;
    return `${ratio}% of ${formatNumber(totalCount)} entries need review`;
  }

  const topOperation = [...operations].sort((left, right) => right.count - left.count)[0];
  if (!topOperation) {
    return 'No failing records in the current slice';
  }
  return `${describeExecutionOperationLabel(topOperation.operation)} leads with ${formatNumber(topOperation.count)} entries`;
}

function sumCost(stats?: LogStatsResponse): number {
  return (stats?.data.groups ?? []).reduce(
    (sum, group) => sum + Number(group.agg.total_cost_usd ?? 0),
    0,
  );
}
