import type {
  DashboardProjectRecord,
  DashboardWorkflowActivationRecord,
  DashboardWorkflowRecord,
  DashboardWorkflowStageRecord,
  DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import { readWorkflowRunSummary } from '../workflow-detail-support.js';

const PROJECT_MEMORY_TRACE_KEYS = new Set(['project_timeline', 'last_run_summary']);

export interface WorkflowInspectorTraceMetric {
  label: string;
  value: string;
  detail: string;
}

export interface WorkflowInspectorTraceLink {
  label: string;
  href: string;
  detail: string;
}

export interface WorkflowInspectorTraceModel {
  metrics: WorkflowInspectorTraceMetric[];
  topStageSpend: string | null;
  latestActivationSummary: string | null;
  links: WorkflowInspectorTraceLink[];
}

export function buildWorkflowInspectorTraceModel(input: {
  workflow?: DashboardWorkflowRecord;
  project?: DashboardProjectRecord;
}): WorkflowInspectorTraceModel {
  const workflow = input.workflow;
  const runSummary = readWorkflowRunSummary(workflow);
  const workflowId = workflow?.id ?? '';
  const projectId = workflow?.project_id ?? input.project?.id ?? null;
  const activations = Array.isArray(workflow?.activations) ? workflow.activations : [];
  const stages = Array.isArray(workflow?.workflow_stages) ? workflow.workflow_stages : [];
  const workItemSummary = workflow?.work_item_summary ?? null;
  const producedArtifacts = asArray(asRecord(runSummary).produced_artifacts);
  const analytics = asRecord(asRecord(runSummary).orchestrator_analytics);
  const traceMemory = readProjectMemoryTraceSummary(input.project);

  return {
    metrics: [
      {
        label: 'Activation batches',
        value: formatCount(activations.length),
        detail: describeActivationMetric(activations),
      },
      {
        label: 'Work items',
        value: formatCount(workItemSummary?.total_work_items ?? 0),
        detail: describeWorkItemMetric(workItemSummary),
      },
      {
        label: 'Gate checkpoints',
        value: formatCount(readAttentionGateCount(stages, workItemSummary?.awaiting_gate_count ?? 0)),
        detail: describeGateMetric(stages, workItemSummary?.awaiting_gate_count ?? 0),
      },
      {
        label: 'Artifacts',
        value: formatCount(producedArtifacts.length),
        detail:
          producedArtifacts.length > 0
            ? 'Run summary artifacts are ready for project-level preview and download.'
            : 'No delivered artifacts were recorded in the current run summary.',
      },
      {
        label: 'Memory handoff',
        value: traceMemory.value,
        detail: traceMemory.detail,
      },
    ],
    topStageSpend: describeTopStageSpend(analytics),
    latestActivationSummary: describeLatestActivationSummary(activations),
    links: buildTraceLinks(workflow, projectId),
  };
}

function describeActivationMetric(activations: DashboardWorkflowActivationRecord[]): string {
  if (activations.length === 0) {
    return 'No activation batches are recorded on this workflow yet.';
  }
  const latest = readLatestActivation(activations);
  if (!latest) {
    return `${activations.length} activation batches are attached to this workflow.`;
  }
  const eventCount = Number(latest.event_count ?? 1);
  return `${humanizeToken(latest.reason)} • ${humanizeToken(latest.state)} • ${eventCount} queued event${eventCount === 1 ? '' : 's'}`;
}

function describeWorkItemMetric(
  summary: DashboardWorkflowRecord['work_item_summary'],
): string {
  if (!summary || summary.total_work_items === 0) {
    return 'No work items are attached to this workflow yet.';
  }
  return `${summary.open_work_item_count} open • ${summary.completed_work_item_count} completed`;
}

function describeGateMetric(
  stages: DashboardWorkflowStageRecord[],
  awaitingGateCount: number,
): string {
  const humanGateCount = stages.filter((stage) => stage.human_gate).length;
  if (awaitingGateCount > 0) {
    return `${awaitingGateCount} waiting for operator review across ${humanGateCount || stages.length} gate stage${humanGateCount === 1 ? '' : 's'}.`;
  }
  if (humanGateCount > 0) {
    return `${humanGateCount} human-gated stage${humanGateCount === 1 ? '' : 's'} are tracked in the board trace.`;
  }
  return 'No active gate checkpoints are waiting in this workflow trace.';
}

function describeTopStageSpend(analytics: Record<string, unknown>): string | null {
  const costByStage = asArray(analytics.cost_by_stage)
    .map((entry) => ({
      stageName: readNonEmptyString(asRecord(entry).group_key) ?? 'unknown stage',
      totalCostUsd: Number(asRecord(entry).total_cost_usd ?? 0),
      taskCount: Number(asRecord(entry).task_count ?? 0),
    }))
    .filter((entry) => Number.isFinite(entry.totalCostUsd) && entry.totalCostUsd > 0)
    .sort((left, right) => right.totalCostUsd - left.totalCostUsd);

  const top = costByStage[0];
  if (!top) {
    return null;
  }
  return `${top.stageName} leads reported spend at $${top.totalCostUsd.toFixed(2)} across ${top.taskCount} step${top.taskCount === 1 ? '' : 's'}.`;
}

function describeLatestActivationSummary(
  activations: DashboardWorkflowActivationRecord[],
): string | null {
  const latest = readLatestActivation(activations);
  if (!latest) {
    return null;
  }
  const parts = [
    `Latest activation: ${humanizeToken(latest.reason)}`,
    humanizeToken(latest.state),
    latest.summary ?? null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(' • ');
}

function readLatestActivation(
  activations: DashboardWorkflowActivationRecord[],
): DashboardWorkflowActivationRecord | null {
  return activations
    .slice()
    .sort((left, right) => readActivationTimestamp(right) - readActivationTimestamp(left))[0] ?? null;
}

function readActivationTimestamp(entry: DashboardWorkflowActivationRecord): number {
  const candidate =
    entry.latest_event_at
    ?? entry.completed_at
    ?? entry.started_at
    ?? entry.queued_at;
  const parsed = Date.parse(candidate ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function readAttentionGateCount(
  stages: DashboardWorkflowStageRecord[],
  awaitingGateCount: number,
): number {
  if (awaitingGateCount > 0) {
    return awaitingGateCount;
  }
  return stages.filter((stage) =>
    ['awaiting_approval', 'changes_requested', 'rejected'].includes(stage.gate_status),
  ).length;
}

function readProjectMemoryTraceSummary(project?: DashboardProjectRecord): {
  value: string;
  detail: string;
} {
  const memory = asRecord(project?.memory);
  const operatorKeys = Object.keys(memory).filter((key) => !PROJECT_MEMORY_TRACE_KEYS.has(key));
  const hasTimelinePackets =
    memory.project_timeline !== undefined || memory.last_run_summary !== undefined;

  if (operatorKeys.length > 0) {
    return {
      value: `${operatorKeys.length} keys`,
      detail: 'Project memory includes operator-visible handoff keys alongside the run timeline packets.',
    };
  }
  if (hasTimelinePackets) {
    return {
      value: 'Timeline ready',
      detail: 'Project memory already carries the run summary and timeline packets for cross-run inspection.',
    };
  }
  return {
    value: 'Not recorded',
    detail: 'No project memory handoff packets are available for this workflow yet.',
  };
}

function buildTraceLinks(
  workflow: DashboardWorkflowRecord | undefined,
  projectId: string | null,
): WorkflowInspectorTraceLink[] {
  const workflowId = workflow?.id ?? '';
  const activations = Array.isArray(workflow?.activations) ? workflow.activations : [];
  const stages = Array.isArray(workflow?.workflow_stages) ? workflow.workflow_stages : [];
  const workItems = Array.isArray(workflow?.work_items) ? workflow.work_items : [];
  const links: WorkflowInspectorTraceLink[] = [
    {
      label: 'Board trace',
      href: `/work/workflows/${workflowId}`,
      detail: 'Open activations, work items, gates, and specialist steps in one board view.',
    },
  ];
  const latestActivation = readLatestActivation(activations);
  if (latestActivation) {
    links.push({
      label: 'Activation drill-in',
      href: buildWorkflowInspectorLogLink(workflowId, {
        view: 'detailed',
        activation: latestActivation.activation_id ?? latestActivation.id,
      }),
      detail:
        latestActivation.summary
        ?? `${humanizeToken(latestActivation.reason)} is the latest activation packet on this workflow.`,
    });
  }
  const highlightedWorkItem = readHighlightedWorkItem(workItems);
  if (highlightedWorkItem) {
    links.push({
      label: 'Open work item',
      href: buildWorkflowBoardLink(workflowId, { work_item: highlightedWorkItem.id }),
      detail: `${highlightedWorkItem.title} is still open in ${highlightedWorkItem.stage_name}.`,
    });
  }
  const highlightedGateStage = readHighlightedGateStage(stages);
  if (highlightedGateStage) {
    links.push({
      label: 'Gate review lane',
      href: buildWorkflowBoardLink(workflowId, { stage: highlightedGateStage.name }),
      detail: `${highlightedGateStage.name} is carrying the current gate posture for this workflow.`,
    });
  }
  if (projectId) {
    links.push(
      {
        label: 'Project memory',
        href: `/projects/${projectId}/memory`,
        detail: 'Inspect memory versions, diffs, and run handoff packets.',
      },
      {
        label: 'Project artifacts',
        href: `/projects/${projectId}/artifacts`,
        detail: 'Review delivered artifacts and workflow output packets.',
      },
    );
  }
  return links;
}

function readHighlightedWorkItem(
  workItems: DashboardWorkflowWorkItemRecord[],
): DashboardWorkflowWorkItemRecord | null {
  return workItems.find((item) => !item.completed_at)
    ?? workItems
      .slice()
      .sort((left, right) => Date.parse(right.updated_at ?? '') - Date.parse(left.updated_at ?? ''))[0]
    ?? null;
}

function readHighlightedGateStage(
  stages: DashboardWorkflowStageRecord[],
): DashboardWorkflowStageRecord | null {
  const activeGate = stages.find((stage) =>
    ['awaiting_approval', 'changes_requested', 'rejected'].includes(stage.gate_status),
  );
  if (activeGate) {
    return activeGate;
  }
  return stages.find((stage) => stage.human_gate) ?? null;
}

function buildWorkflowBoardLink(
  workflowId: string,
  params: Record<string, string>,
): string {
  const searchParams = new URLSearchParams(params);
  const query = searchParams.toString();
  return query
    ? `/work/workflows/${workflowId}?${query}`
    : `/work/workflows/${workflowId}`;
}

function buildWorkflowInspectorLogLink(
  workflowId: string,
  params: { view: 'summary' | 'detailed' | 'debug'; activation?: string },
): string {
  const searchParams = new URLSearchParams({ view: params.view });
  if (params.activation) {
    searchParams.set('activation', params.activation);
  }
  return `/work/workflows/${workflowId}/inspector?${searchParams.toString()}`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : [];
}

function humanizeToken(value: string | null | undefined): string {
  if (!value) {
    return 'Unknown';
  }
  return value.replace(/[_-]+/g, ' ').trim();
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
