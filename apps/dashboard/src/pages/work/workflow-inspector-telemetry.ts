import type { DashboardWorkflowRecord, LogStatsResponse } from '../../lib/api.js';
import { formatCost, formatDuration, shortId } from '../../components/execution-inspector-support.js';
import { readWorkflowRunSummary } from '../workflow-detail-support.js';
import type { WorkflowInspectorFocusWorkItem } from './workflow-inspector-support.js';
import {
  buildWorkflowInspectorMemoryPacket,
  type WorkflowInspectorMemoryPacket,
} from './workflow-inspector-memory-packet.js';
import { buildWorkItemBreakdownEntries } from './workflow-inspector-work-item-breakdown.js';

export interface WorkflowInspectorSpendPacket {
  label: string;
  value: string;
  detail: string;
  href: string | null;
}

export interface WorkflowInspectorSpendBreakdownSection {
  title: string;
  description: string;
  entries: WorkflowInspectorSpendPacket[];
}

export interface WorkflowInspectorTelemetryModel {
  spendPackets: WorkflowInspectorSpendPacket[];
  spendBreakdowns: WorkflowInspectorSpendBreakdownSection[];
  memoryPacket: WorkflowInspectorMemoryPacket;
}

export function buildWorkflowInspectorTelemetryModel(input: {
  workflowId: string;
  workflow?: DashboardWorkflowRecord;
  taskCostStats?: LogStatsResponse;
  activationCostStats?: LogStatsResponse;
  focusWorkItem?: WorkflowInspectorFocusWorkItem | null;
  memoryHistory?: Parameters<typeof buildWorkflowInspectorMemoryPacket>[0]['memoryHistory'];
  now?: number;
}): WorkflowInspectorTelemetryModel {
  return {
    spendPackets: buildSpendPackets(input),
    spendBreakdowns: buildSpendBreakdowns(input),
    memoryPacket: buildWorkflowInspectorMemoryPacket({
      focusWorkItem: input.focusWorkItem,
      memoryHistory: input.memoryHistory,
      now: input.now,
    }),
  };
}

function buildSpendPackets(input: {
  workflowId: string;
  workflow?: DashboardWorkflowRecord;
  taskCostStats?: LogStatsResponse;
  activationCostStats?: LogStatsResponse;
}): WorkflowInspectorSpendPacket[] {
  return [
    buildStageSpendPacket(input.workflowId, input.workflow),
    buildTaskSpendPacket(input.workflowId, input.taskCostStats),
    buildActivationSpendPacket(input.workflowId, input.workflow, input.activationCostStats),
  ];
}

function buildSpendBreakdowns(input: {
  workflowId: string;
  workflow?: DashboardWorkflowRecord;
  taskCostStats?: LogStatsResponse;
  activationCostStats?: LogStatsResponse;
}): WorkflowInspectorSpendBreakdownSection[] {
  return [
    {
      title: 'Stage breakdown',
      description: 'Top reported stage spend from the workflow run summary.',
      entries: buildStageBreakdownEntries(input.workflowId, input.workflow),
    },
    {
      title: 'Task breakdown',
      description: 'Top task-level spend from the current inspector log slice.',
      entries: buildTaskBreakdownEntries(input.workflowId, input.taskCostStats),
    },
    {
      title: 'Activation breakdown',
      description: 'Top orchestrator activation spend from the current inspector slice.',
      entries: buildActivationBreakdownEntries(input.workflowId, input.activationCostStats),
    },
    {
      title: 'Work item breakdown',
      description: 'Top workflow work-item spend from the current run summary.',
      entries: buildWorkItemBreakdownEntries(input.workflowId, input.workflow),
    },
  ];
}

function buildStageSpendPacket(
  workflowId: string,
  workflow?: DashboardWorkflowRecord,
): WorkflowInspectorSpendPacket {
  const analytics = asRecord(asRecord(readWorkflowRunSummary(workflow)).orchestrator_analytics);
  const topStage = asArray(analytics.cost_by_stage)
    .map((entry) => ({
      stageName:
        readString(asRecord(entry).stage_name)
        ?? readString(asRecord(entry).group_key)
        ?? 'unassigned',
      taskCount: Number(asRecord(entry).task_count ?? 0),
      totalCostUsd: Number(asRecord(entry).total_cost_usd ?? 0),
    }))
    .filter((entry) => Number.isFinite(entry.totalCostUsd) && entry.totalCostUsd > 0)
    .sort((left, right) => right.totalCostUsd - left.totalCostUsd)[0];

  if (!topStage) {
    return missingSpendPacket(
      'Stage cost leader',
      'No stage-level cost packet is available in the current run summary yet.',
    );
  }

  return {
    label: 'Stage cost leader',
    value: formatCost(topStage.totalCostUsd),
    detail: `${topStage.stageName} is leading reported stage spend across ${topStage.taskCount} step${topStage.taskCount === 1 ? '' : 's'}.`,
    href: buildWorkflowInspectorLink(workflowId, { view: 'detailed', stage: topStage.stageName }),
  };
}

function buildTaskSpendPacket(
  workflowId: string,
  stats?: LogStatsResponse,
): WorkflowInspectorSpendPacket {
  const topTask = topCostGroup(stats, (group) => group.group !== 'unassigned');
  if (!topTask) {
    return missingSpendPacket(
      'Task cost leader',
      'No task-level spend has been recorded in the current inspector slice yet.',
    );
  }

  return {
    label: 'Task cost leader',
    value: formatCost(readGroupCost(topTask)),
    detail: `Step ${shortId(topTask.group)} leads the current log slice across ${topTask.count} trace entr${topTask.count === 1 ? 'y' : 'ies'} • ${formatDuration(topTask.avg_duration_ms)} average recorded duration.`,
    href: buildWorkflowInspectorLink(workflowId, { view: 'detailed', task: topTask.group }),
  };
}

function buildActivationSpendPacket(
  workflowId: string,
  workflow: DashboardWorkflowRecord | undefined,
  stats?: LogStatsResponse,
): WorkflowInspectorSpendPacket {
  const topActivation = topCostGroup(stats, (group) => group.group !== 'unassigned');
  if (topActivation) {
    return {
      label: 'Activation cost leader',
      value: formatCost(readGroupCost(topActivation)),
      detail: `Activation ${shortId(topActivation.group)} is carrying the highest orchestrator batch spend across ${topActivation.count} trace entr${topActivation.count === 1 ? 'y' : 'ies'}.`,
      href: buildWorkflowInspectorLink(workflowId, {
        view: 'detailed',
        activation: topActivation.group,
      }),
    };
  }

  const analytics = asRecord(asRecord(readWorkflowRunSummary(workflow)).orchestrator_analytics);
  const activationCount = Number(analytics.activation_count ?? 0);
  const totalCostUsd = Number(analytics.total_cost_usd ?? 0);
  if (!Number.isFinite(totalCostUsd) || totalCostUsd <= 0 || activationCount <= 0) {
    return missingSpendPacket(
      'Activation cost leader',
      'No activation-level spend packet is available for this workflow yet.',
    );
  }

  return {
    label: 'Activation cost leader',
    value: formatCost(totalCostUsd / activationCount),
    detail: `Average orchestrator activation spend from ${activationCount} recorded activation batch${activationCount === 1 ? '' : 'es'}.`,
    href: buildWorkflowInspectorLink(workflowId, { view: 'detailed' }),
  };
}

function buildStageBreakdownEntries(
  workflowId: string,
  workflow?: DashboardWorkflowRecord,
): WorkflowInspectorSpendPacket[] {
  const analytics = asRecord(asRecord(readWorkflowRunSummary(workflow)).orchestrator_analytics);
  return asArray(analytics.cost_by_stage)
    .map((entry) => ({
      label:
        readString(asRecord(entry).stage_name)
        ?? readString(asRecord(entry).group_key)
        ?? 'Unassigned stage',
      value: formatCost(Number(asRecord(entry).total_cost_usd ?? 0)),
      detail: `${Number(asRecord(entry).task_count ?? 0)} step${Number(asRecord(entry).task_count ?? 0) === 1 ? '' : 's'} contributed to this stage.`,
      href: buildWorkflowInspectorLink(workflowId, {
        view: 'detailed',
        stage:
          readString(asRecord(entry).stage_name)
          ?? readString(asRecord(entry).group_key)
          ?? 'unassigned',
      }),
    }))
    .filter((entry) => entry.value !== '$0.0000')
    .slice(0, 3);
}

function buildTaskBreakdownEntries(
  workflowId: string,
  stats?: LogStatsResponse,
): WorkflowInspectorSpendPacket[] {
  return buildStatsBreakdownEntries(stats, {
    formatLabel: (group) => `Step ${shortId(group.group)}`,
    formatDetail: (group) =>
      `${group.count} trace entr${group.count === 1 ? 'y' : 'ies'} • ${formatDuration(group.avg_duration_ms)} average recorded duration.`,
    hrefFor: (group) => buildWorkflowInspectorLink(workflowId, { view: 'detailed', task: group.group }),
  });
}

function buildActivationBreakdownEntries(
  workflowId: string,
  stats?: LogStatsResponse,
): WorkflowInspectorSpendPacket[] {
  return buildStatsBreakdownEntries(stats, {
    formatLabel: (group) => `Activation ${shortId(group.group)}`,
    formatDetail: (group) =>
      `${group.count} trace entr${group.count === 1 ? 'y' : 'ies'} • ${formatDuration(group.avg_duration_ms)} average recorded duration.`,
    hrefFor: (group) =>
      buildWorkflowInspectorLink(workflowId, { view: 'detailed', activation: group.group }),
  });
}

function buildStatsBreakdownEntries(
  stats: LogStatsResponse | undefined,
  helpers: {
    formatLabel(group: LogStatsResponse['data']['groups'][number]): string;
    formatDetail(group: LogStatsResponse['data']['groups'][number]): string;
    hrefFor(group: LogStatsResponse['data']['groups'][number]): string;
  },
): WorkflowInspectorSpendPacket[] {
  return [...(stats?.data.groups ?? [])]
    .filter((group) => group.group !== 'unassigned')
    .filter((group) => readGroupCost(group) > 0)
    .sort((left, right) => readGroupCost(right) - readGroupCost(left))
    .slice(0, 3)
    .map((group) => ({
      label: helpers.formatLabel(group),
      value: formatCost(readGroupCost(group)),
      detail: helpers.formatDetail(group),
      href: helpers.hrefFor(group),
    }));
}

function topCostGroup(
  stats: LogStatsResponse | undefined,
  predicate: (group: LogStatsResponse['data']['groups'][number]) => boolean,
) {
  return [...(stats?.data.groups ?? [])]
    .filter(predicate)
    .filter((group) => readGroupCost(group) > 0)
    .sort((left, right) => readGroupCost(right) - readGroupCost(left))[0];
}

function missingSpendPacket(
  label: string,
  detail: string,
): WorkflowInspectorSpendPacket {
  return { label, value: 'Not recorded', detail, href: null };
}

function readGroupCost(group: LogStatsResponse['data']['groups'][number]): number {
  return Number(group.agg.total_cost_usd ?? 0);
}

function buildWorkflowInspectorLink(
  workflowId: string,
  params: Record<string, string>,
): string {
  const searchParams = new URLSearchParams(params);
  return `/work/workflows/${workflowId}/inspector?${searchParams.toString()}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : [];
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
