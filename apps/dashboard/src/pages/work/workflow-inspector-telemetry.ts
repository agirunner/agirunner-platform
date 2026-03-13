import type { DashboardWorkflowRecord, LogStatsResponse } from '../../lib/api.js';
import {
  formatCost,
  formatDuration,
  shortId,
} from '../../components/execution-inspector-support.js';
import { readWorkflowRunSummary } from '../workflow-detail-support.js';
import type { WorkflowInspectorFocusWorkItem } from './workflow-inspector-support.js';
import {
  buildWorkflowInspectorMemoryPacket,
  type WorkflowInspectorMemoryPacket,
} from './workflow-inspector-memory-packet.js';

export interface WorkflowInspectorSpendPacket {
  label: string;
  value: string;
  detail: string;
  href: string | null;
}

export interface WorkflowInspectorTelemetryModel {
  spendPackets: WorkflowInspectorSpendPacket[];
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
    spendPackets: [
      buildStageSpendPacket(input.workflowId, input.workflow),
      buildTaskSpendPacket(input.workflowId, input.taskCostStats),
      buildActivationSpendPacket(
        input.workflowId,
        input.workflow,
        input.activationCostStats,
      ),
    ],
    memoryPacket: buildWorkflowInspectorMemoryPacket({
      focusWorkItem: input.focusWorkItem,
      memoryHistory: input.memoryHistory,
      now: input.now,
    }),
  };
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
