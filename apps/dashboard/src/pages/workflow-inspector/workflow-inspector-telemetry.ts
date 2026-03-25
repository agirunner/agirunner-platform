import type { DashboardWorkflowRecord, LogStatsResponse } from '../../lib/api.js';
import { formatCost, formatDuration, shortId } from '../../components/execution-inspector/execution-inspector-support.js';
import { readWorkflowRunSummary } from '../workflow-detail/workflow-detail-support.js';
import {
  buildWorkflowInspectorExecutionSummaryPackets,
  type WorkflowInspectorExecutionSummaryPacket,
} from './workflow-inspector-execution-summary.js';
import type { WorkflowInspectorFocusWorkItem } from './workflow-inspector-support.js';
import { describeSpendBreakdownCoverage } from './workflow-inspector-breakdown-coverage.js';
import {
  buildWorkflowInspectorMemoryPacket,
  type WorkflowInspectorMemoryPacket,
} from './workflow-inspector-memory-packet.js';
import {
  asArray,
  asRecord,
  buildStatsBreakdownEntries as buildTelemetryStatsBreakdownEntries,
  buildWorkflowInspectorLink,
  missingSpendPacket,
  readCostFromPacket,
  readGroupCost,
  readString,
  stripBreakdownCost,
  sumBreakdownCost,
  topCostGroup,
} from './workflow-inspector-telemetry-support.js';
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
  coverageLabel: string;
  coverageDetail: string;
  entries: WorkflowInspectorSpendPacket[];
}

export interface WorkflowInspectorTelemetryModel {
  executionSummaryPackets: WorkflowInspectorExecutionSummaryPacket[];
  spendPackets: WorkflowInspectorSpendPacket[];
  spendBreakdowns: WorkflowInspectorSpendBreakdownSection[];
  memoryPacket: WorkflowInspectorMemoryPacket;
}

interface WorkflowInspectorSpendBreakdownEntry extends WorkflowInspectorSpendPacket {
  costUsd: number;
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
    executionSummaryPackets: buildWorkflowInspectorExecutionSummaryPackets(input),
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
    buildSpendBreakdownSection({
      title: 'Stage breakdown',
      description: 'Top reported stage spend from the workflow run summary.',
      nounSingular: 'stage',
      nounPlural: 'stages',
      entries: buildStageBreakdownEntries(input.workflowId, input.workflow),
    }),
    buildSpendBreakdownSection({
      title: 'Task breakdown',
      description: 'Top task-level spend from the current inspector log slice.',
      nounSingular: 'task',
      nounPlural: 'tasks',
      entries: buildTaskBreakdownEntries(input.workflowId, input.taskCostStats),
    }),
    buildSpendBreakdownSection({
      title: 'Activation breakdown',
      description: 'Top orchestrator activation spend from the current inspector slice.',
      nounSingular: 'activation',
      nounPlural: 'activations',
      entries: buildActivationBreakdownEntries(input.workflowId, input.activationCostStats),
    }),
    buildSpendBreakdownSection({
      title: 'Work item breakdown',
      description: 'Top workflow work-item spend from the current run summary.',
      nounSingular: 'work item',
      nounPlural: 'work items',
      entries: buildWorkItemBreakdownEntries(input.workflowId, input.workflow).map((entry) => ({
        ...entry,
        costUsd: readCostFromPacket(entry.value),
      })),
    }),
  ];
}

function buildSpendBreakdownSection(input: {
  title: string;
  description: string;
  nounSingular: string;
  nounPlural: string;
  entries: WorkflowInspectorSpendBreakdownEntry[];
}): WorkflowInspectorSpendBreakdownSection {
  const visibleEntries = input.entries.slice(0, 3).map(stripBreakdownCost);
  const coverage = describeSpendBreakdownCoverage({
    nounSingular: input.nounSingular,
    nounPlural: input.nounPlural,
    totalCount: input.entries.length,
    visibleCount: visibleEntries.length,
    totalCostUsd: sumBreakdownCost(input.entries),
    visibleCostUsd: sumBreakdownCost(input.entries.slice(0, 3)),
  });

  return {
    title: input.title,
    description: input.description,
    coverageLabel: coverage.label,
    coverageDetail: coverage.detail,
    entries: visibleEntries,
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
    href: buildWorkflowInspectorLink(workflowId, { view: 'summary', stage: topStage.stageName }),
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
    href: buildWorkflowInspectorLink(workflowId, { view: 'summary', task: topTask.group }),
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
        view: 'summary',
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
    href: buildWorkflowInspectorLink(workflowId, { view: 'summary' }),
  };
}

function buildStageBreakdownEntries(
  workflowId: string,
  workflow?: DashboardWorkflowRecord,
): WorkflowInspectorSpendBreakdownEntry[] {
  const analytics = asRecord(asRecord(readWorkflowRunSummary(workflow)).orchestrator_analytics);
  return asArray(analytics.cost_by_stage)
    .map((entry) => {
      const totalCostUsd = Number(asRecord(entry).total_cost_usd ?? 0);
      return {
        label:
          readString(asRecord(entry).stage_name)
          ?? readString(asRecord(entry).group_key)
          ?? 'Unassigned stage',
        value: formatCost(totalCostUsd),
        detail: `${Number(asRecord(entry).task_count ?? 0)} step${Number(asRecord(entry).task_count ?? 0) === 1 ? '' : 's'} contributed to this stage.`,
        costUsd: totalCostUsd,
        href: buildWorkflowInspectorLink(workflowId, {
          view: 'summary',
          stage:
            readString(asRecord(entry).stage_name)
            ?? readString(asRecord(entry).group_key)
            ?? 'unassigned',
        }),
      };
    })
    .filter((entry) => entry.costUsd > 0);
}

function buildTaskBreakdownEntries(
  workflowId: string,
  stats?: LogStatsResponse,
): WorkflowInspectorSpendBreakdownEntry[] {
  return buildTelemetryStatsBreakdownEntries(stats, {
    formatLabel: (group) => `Step ${shortId(group.group)}`,
    formatDetail: (group) =>
      `${group.count} trace entr${group.count === 1 ? 'y' : 'ies'} • ${formatDuration(group.avg_duration_ms)} average recorded duration.`,
    hrefFor: (group) => buildWorkflowInspectorLink(workflowId, { view: 'summary', task: group.group }),
  });
}

function buildActivationBreakdownEntries(
  workflowId: string,
  stats?: LogStatsResponse,
): WorkflowInspectorSpendBreakdownEntry[] {
  return buildTelemetryStatsBreakdownEntries(stats, {
    formatLabel: (group) => `Activation ${shortId(group.group)}`,
    formatDetail: (group) =>
      `${group.count} trace entr${group.count === 1 ? 'y' : 'ies'} • ${formatDuration(group.avg_duration_ms)} average recorded duration.`,
    hrefFor: (group) =>
      buildWorkflowInspectorLink(workflowId, { view: 'summary', activation: group.group }),
  });
}
