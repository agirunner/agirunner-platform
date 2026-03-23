import type { DashboardWorkflowRecord, LogStatsResponse } from '../../lib/api.js';
import { formatCost, formatDuration } from '../../components/execution-inspector/execution-inspector-support.js';
import { readWorkflowRunSummary } from '../workflow-detail/workflow-detail-support.js';
import {
  asArray,
  asRecord,
  buildWorkflowInspectorLink,
  readGroupCost,
  readString,
} from './workflow-inspector-telemetry-support.js';

export interface WorkflowInspectorExecutionSummaryPacket {
  label: string;
  value: string;
  detail: string;
  sourceLabel: string;
  href: string | null;
}

export function buildWorkflowInspectorExecutionSummaryPackets(input: {
  workflowId: string;
  workflow?: DashboardWorkflowRecord;
  taskCostStats?: LogStatsResponse;
  activationCostStats?: LogStatsResponse;
}): WorkflowInspectorExecutionSummaryPacket[] {
  return [
    buildStageExecutionSummary(input.workflowId, input.workflow),
    buildTaskExecutionSummary(input.workflowId, input.taskCostStats),
    buildActivationExecutionSummary(input.workflowId, input.activationCostStats),
    buildWorkItemExecutionSummary(input.workflowId, input.workflow),
  ];
}

function buildStageExecutionSummary(
  workflowId: string,
  workflow?: DashboardWorkflowRecord,
): WorkflowInspectorExecutionSummaryPacket {
  const analytics = asRecord(asRecord(readWorkflowRunSummary(workflow)).orchestrator_analytics);
  const entries = asArray(analytics.cost_by_stage)
    .map((entry) => ({
      totalCostUsd: Number(asRecord(entry).total_cost_usd ?? 0),
      taskCount: Number(asRecord(entry).task_count ?? 0),
    }))
    .filter((entry) => entry.totalCostUsd > 0);

  if (entries.length === 0) {
    return missingExecutionSummary(
      'Stage spend coverage',
      'Workflow run summary',
      'No stage-level spend is available in the workflow run summary yet.',
    );
  }

  const taskCount = entries.reduce((total, entry) => total + entry.taskCount, 0);
  return {
    label: 'Stage spend coverage',
    value: formatCost(entries.reduce((total, entry) => total + entry.totalCostUsd, 0)),
    detail: `${entries.length} recorded stage${entries.length === 1 ? '' : 's'} across ${taskCount} contributing step${taskCount === 1 ? '' : 's'}.`,
    sourceLabel: 'Workflow run summary',
    href: buildWorkflowInspectorLink(workflowId, { view: 'detailed' }),
  };
}

function buildTaskExecutionSummary(
  workflowId: string,
  stats?: LogStatsResponse,
): WorkflowInspectorExecutionSummaryPacket {
  const groups = (stats?.data.groups ?? [])
    .filter((group) => group.group !== 'unassigned')
    .filter((group) => readGroupCost(group) > 0);

  if (groups.length === 0) {
    return missingExecutionSummary(
      'Task spend coverage',
      'Inspector log slice',
      'No task-level spend is available in the current inspector log slice yet.',
    );
  }

  const totals = stats?.data.totals;
  return {
    label: 'Task spend coverage',
    value: formatCost(groups.reduce((total, group) => total + readGroupCost(group), 0)),
    detail: `${groups.length} traced step${groups.length === 1 ? '' : 's'} across ${totals?.count ?? 0} trace entr${totals?.count === 1 ? 'y' : 'ies'} • ${formatDuration(totals?.total_duration_ms ?? 0)} total recorded duration.`,
    sourceLabel: 'Inspector log slice',
    href: buildWorkflowInspectorLink(workflowId, { view: 'detailed' }),
  };
}

function buildActivationExecutionSummary(
  workflowId: string,
  stats?: LogStatsResponse,
): WorkflowInspectorExecutionSummaryPacket {
  const groups = (stats?.data.groups ?? [])
    .filter((group) => group.group !== 'unassigned')
    .filter((group) => readGroupCost(group) > 0);

  if (groups.length === 0) {
    return missingExecutionSummary(
      'Activation spend coverage',
      'Inspector orchestrator slice',
      'No activation-level spend is available in the current orchestrator slice yet.',
    );
  }

  const totals = stats?.data.totals;
  return {
    label: 'Activation spend coverage',
    value: formatCost(groups.reduce((total, group) => total + readGroupCost(group), 0)),
    detail: `${groups.length} orchestrator activation${groups.length === 1 ? '' : 's'} across ${totals?.count ?? 0} trace entr${totals?.count === 1 ? 'y' : 'ies'} • ${formatDuration(totals?.total_duration_ms ?? 0)} total recorded duration.`,
    sourceLabel: 'Inspector orchestrator slice',
    href: buildWorkflowInspectorLink(workflowId, { view: 'detailed' }),
  };
}

function buildWorkItemExecutionSummary(
  workflowId: string,
  workflow?: DashboardWorkflowRecord,
): WorkflowInspectorExecutionSummaryPacket {
  const analytics = asRecord(asRecord(readWorkflowRunSummary(workflow)).orchestrator_analytics);
  const entries = asArray(analytics.cost_by_work_item)
    .map((entry) => ({
      totalCostUsd: Number(asRecord(entry).total_cost_usd ?? 0),
      taskCount: Number(asRecord(entry).task_count ?? 0),
      workItemId: readString(asRecord(entry).work_item_id),
    }))
    .filter((entry) => entry.totalCostUsd > 0);

  if (entries.length === 0) {
    return missingExecutionSummary(
      'Work item spend coverage',
      'Workflow run summary',
      'No work-item-level spend is available in the workflow run summary yet.',
    );
  }

  const taskCount = entries.reduce((total, entry) => total + entry.taskCount, 0);
  return {
    label: 'Work item spend coverage',
    value: formatCost(entries.reduce((total, entry) => total + entry.totalCostUsd, 0)),
    detail: `${entries.length} workflow work item${entries.length === 1 ? '' : 's'} across ${taskCount} contributing step${taskCount === 1 ? '' : 's'}.`,
    sourceLabel: 'Workflow run summary',
    href: buildWorkflowInspectorLink(workflowId, { view: 'detailed' }),
  };
}

function missingExecutionSummary(
  label: string,
  sourceLabel: string,
  detail: string,
): WorkflowInspectorExecutionSummaryPacket {
  return {
    label,
    value: 'Not recorded',
    detail,
    sourceLabel,
    href: null,
  };
}
