import type {
  DashboardWorkspaceRecord,
  DashboardWorkflowActivationRecord,
  DashboardTaskHandoffRecord,
  DashboardWorkflowRecord,
  DashboardWorkflowStageRecord,
  DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import { readWorkflowRunSummary } from '../workflow-detail-support.js';
import {
  buildWorkflowInspectorTraceLinks,
  readHighlightedWorkItem,
} from './workflow-inspector-trace-links.js';

const WORKSPACE_MEMORY_TRACE_KEYS = new Set(['workspace_timeline', 'last_run_summary']);

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

export interface WorkflowInspectorFocusWorkItem {
  id: string;
  title: string;
  stageName: string;
  reworkCount?: number;
  currentSubjectRevision?: number | null;
  nextExpectedActor: string | null;
  nextExpectedAction: string | null;
  unresolvedFindingsCount: number;
  assessmentFocusCount: number;
  knownRiskCount: number;
  latestHandoffCompletion: string | null;
}

export interface WorkflowInspectorTraceModel {
  metrics: WorkflowInspectorTraceMetric[];
  topStageSpend: string | null;
  latestActivationSummary: string | null;
  links: WorkflowInspectorTraceLink[];
  focusWorkItem: WorkflowInspectorFocusWorkItem | null;
}

export interface WorkflowInspectorFocusSummary { title: string; detail: string; nextAction: string; actionLabel: string; actionHref: string; }

export function buildWorkflowInspectorTraceModel(input: {
  workflow?: DashboardWorkflowRecord;
  workspace?: DashboardWorkspaceRecord;
}): WorkflowInspectorTraceModel {
  const workflow = input.workflow;
  const runSummary = readWorkflowRunSummary(workflow);
  const activations = Array.isArray(workflow?.activations) ? workflow.activations : [];
  const stages = Array.isArray(workflow?.workflow_stages) ? workflow.workflow_stages : [];
  const workItemSummary = workflow?.work_item_summary ?? null;
  const producedArtifacts = asArray(asRecord(runSummary).produced_artifacts);
  const analytics = asRecord(asRecord(runSummary).orchestrator_analytics);
  const workspaceId = workflow?.workspace_id ?? input.workspace?.id ?? null;
  const traceMemory = readWorkspaceMemoryTraceSummary(input.workspace);
  const focusWorkItem = readHighlightedWorkItem(
    Array.isArray(workflow?.work_items) ? workflow.work_items : [],
  );

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
        label: 'Continuity',
        value: describeContinuityValue(focusWorkItem),
        detail: describeContinuityDetail(focusWorkItem),
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
            ? 'Run summary artifacts are ready for workspace-level preview and download.'
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
    links: buildWorkflowInspectorTraceLinks(workflow, workspaceId, readLatestActivation),
    focusWorkItem: focusWorkItem
        ? {
            id: focusWorkItem.id,
            title: focusWorkItem.title,
            stageName: focusWorkItem.stage_name,
            reworkCount: focusWorkItem.rework_count ?? 0,
            currentSubjectRevision: focusWorkItem.current_subject_revision ?? null,
            nextExpectedActor: focusWorkItem.next_expected_actor ?? null,
            nextExpectedAction: focusWorkItem.next_expected_action ?? null,
            unresolvedFindingsCount: focusWorkItem.unresolved_findings?.length ?? 0,
            assessmentFocusCount: focusWorkItem.review_focus?.length ?? 0,
            knownRiskCount: focusWorkItem.known_risks?.length ?? 0,
            latestHandoffCompletion: focusWorkItem.latest_handoff_completion ?? null,
          }
      : null,
  };
}

export function buildWorkflowInspectorFocusSummary(input: {
  workflowId: string;
  workflow?: DashboardWorkflowRecord;
  liveStageLabel: string;
  traceModel: WorkflowInspectorTraceModel;
  latestHandoff?: DashboardTaskHandoffRecord | null;
}): WorkflowInspectorFocusSummary {
  const awaitingGateCount = input.workflow?.work_item_summary?.awaiting_gate_count ?? 0;
  if (awaitingGateCount > 0) {
    return {
      title: 'Gate decision needs attention first',
      detail: `${awaitingGateCount} gate checkpoint${awaitingGateCount === 1 ? ' is' : 's are'} waiting across ${input.liveStageLabel}.`,
      nextAction:
        'Start with the board stage that is waiting for operator decision, then use the trace packets below to confirm spend, artifacts, and memory context before deciding.',
      actionLabel: 'Open board stage',
      actionHref: `/work/boards/${input.workflowId}`,
    };
  }

  if (input.traceModel.focusWorkItem) {
    const focusItem = input.traceModel.focusWorkItem;
    const continuityDetail = describeFocusContinuityDetail(focusItem, input.latestHandoff ?? null);
    return {
      title: `Focus on ${focusItem.title}`,
      detail: continuityDetail,
      nextAction:
        'Open the focus work item first, clear the unresolved findings and assessment focus notes, then decide whether the next move is approval, rework, or a new orchestrator turn.',
      actionLabel: 'Open focus work item',
      actionHref: `/work/boards/${input.workflowId}?work_item=${encodeURIComponent(focusItem.id)}`,
    };
  }

  if (input.traceModel.latestActivationSummary) {
    return {
      title: 'Latest activation is the best starting point',
      detail: input.traceModel.latestActivationSummary,
      nextAction:
        'Review the latest orchestrator batch first, then move into board or workspace drill-ins only if the activation packet does not explain the current workflow posture.',
      actionLabel: 'Open board trace',
      actionHref: `/work/boards/${input.workflowId}`,
    };
  }

  return {
    title: 'Trace coverage is still warming up',
    detail: 'This workflow does not yet have a strong focus work item or activation packet.',
    nextAction:
      'Open the board trace first, confirm whether the run has started producing work items, and return here after the first activation and memory packets land.',
    actionLabel: 'Open board trace',
    actionHref: `/work/boards/${input.workflowId}`,
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

function describeWorkItemMetric(summary: DashboardWorkflowRecord['work_item_summary']): string {
  if (!summary || summary.total_work_items === 0) {
    return 'No work items are attached to this workflow yet.';
  }
  return `${summary.open_work_item_count} open • ${summary.completed_work_item_count} completed`;
}

function describeContinuityValue(focusWorkItem: DashboardWorkflowWorkItemRecord | null) {
  if (!focusWorkItem) {
    return 'No focus item';
  }
  const actor = focusWorkItem.next_expected_actor?.trim();
  const action = focusWorkItem.next_expected_action?.trim();
  if (actor && action) {
    return `${actor} -> ${action}`;
  }
  if (actor) {
    return actor;
  }
  if (action) {
    return action;
  }
  return 'No pending routing';
}

function describeContinuityDetail(focusWorkItem: DashboardWorkflowWorkItemRecord | null) {
  if (!focusWorkItem) {
    return 'No focus work item is carrying continuity pressure yet.';
  }
  const unresolvedCount = focusWorkItem.unresolved_findings?.length ?? 0;
  if (unresolvedCount > 0) {
    return `${unresolvedCount} unresolved finding${unresolvedCount === 1 ? ' is' : 's are'} still attached to the focus work item.`;
  }
  return 'No unresolved findings are recorded on the focus work item right now.';
}

function describeFocusContinuityDetail(
  focusWorkItem: WorkflowInspectorFocusWorkItem,
  latestHandoff: DashboardTaskHandoffRecord | null,
) {
  const fragments: string[] = [];
  const reworkCount = focusWorkItem.reworkCount ?? 0;
  if (focusWorkItem.stageName.trim().length > 0) {
    fragments.push(`Stage ${focusWorkItem.stageName}`);
  }
  if ((focusWorkItem.currentSubjectRevision ?? 0) > 0) {
    fragments.push(`Subject revision ${focusWorkItem.currentSubjectRevision}`);
  }
  if (reworkCount > 0) {
    fragments.push(`${reworkCount} rework${reworkCount === 1 ? '' : 's'}`);
  }
  if (focusWorkItem.unresolvedFindingsCount > 0) {
    fragments.push(
      `${focusWorkItem.unresolvedFindingsCount} unresolved finding${focusWorkItem.unresolvedFindingsCount === 1 ? '' : 's'}`,
    );
  }
  if (focusWorkItem.assessmentFocusCount > 0) {
    fragments.push(
      `${focusWorkItem.assessmentFocusCount} assessment focus item${focusWorkItem.assessmentFocusCount === 1 ? '' : 's'}`,
    );
  }
  if (focusWorkItem.knownRiskCount > 0) {
    fragments.push(`${focusWorkItem.knownRiskCount} known risk${focusWorkItem.knownRiskCount === 1 ? '' : 's'}`);
  }
  if (latestHandoff?.summary) {
    fragments.push(`Latest handoff: ${latestHandoff.summary}`);
  }
  if (latestHandoff?.successor_context) {
    fragments.push(`Successor context: ${latestHandoff.successor_context}`);
  }
  if (focusWorkItem.nextExpectedActor && focusWorkItem.nextExpectedAction) {
    fragments.push(`Next actor: ${focusWorkItem.nextExpectedActor} should ${focusWorkItem.nextExpectedAction} next`);
  } else if (focusWorkItem.nextExpectedActor) {
    fragments.push(`Next actor: ${focusWorkItem.nextExpectedActor}`);
  } else if (focusWorkItem.nextExpectedAction) {
    fragments.push(`Next action: ${focusWorkItem.nextExpectedAction}`);
  }

  if (fragments.length > 0) {
    return fragments.join(' • ');
  }
  return `${focusWorkItem.stageName} is the most relevant live work-item context in this trace.`;
}

function describeGateMetric(
  stages: DashboardWorkflowStageRecord[],
  awaitingGateCount: number,
): string {
  const humanGateCount = stages.filter((stage) => stage.human_gate).length;
  if (awaitingGateCount > 0) {
    return `${awaitingGateCount} waiting for operator decision across ${humanGateCount || stages.length} gate stage${humanGateCount === 1 ? '' : 's'}.`;
  }
  if (humanGateCount > 0) {
    return `${humanGateCount} human-gated stage${humanGateCount === 1 ? '' : 's'} are tracked in the board trace.`;
  }
  return 'No active gate checkpoints are waiting in this workflow trace.';
}

function describeTopStageSpend(analytics: Record<string, unknown>): string | null {
  const topStage = asArray(analytics.cost_by_stage)
    .map((entry) => ({
      stageName: readNonEmptyString(asRecord(entry).group_key) ?? 'unknown stage',
      totalCostUsd: Number(asRecord(entry).total_cost_usd ?? 0),
      taskCount: Number(asRecord(entry).task_count ?? 0),
    }))
    .filter((entry) => Number.isFinite(entry.totalCostUsd) && entry.totalCostUsd > 0)
    .sort((left, right) => right.totalCostUsd - left.totalCostUsd)[0];

  if (!topStage) {
    return null;
  }

  return `${topStage.stageName} leads reported spend at $${topStage.totalCostUsd.toFixed(2)} across ${topStage.taskCount} step${topStage.taskCount === 1 ? '' : 's'}.`;
}

function describeLatestActivationSummary(
  activations: DashboardWorkflowActivationRecord[],
): string | null {
  const latest = readLatestActivation(activations);
  if (!latest) {
    return null;
  }
  return [
    `Latest activation: ${humanizeToken(latest.reason)}`,
    humanizeToken(latest.state),
    latest.summary ?? null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' • ');
}

export function readLatestActivation(
  activations: DashboardWorkflowActivationRecord[],
): DashboardWorkflowActivationRecord | null {
  return activations
    .slice()
    .sort((left, right) => readActivationTimestamp(right) - readActivationTimestamp(left))[0] ?? null;
}

function readActivationTimestamp(entry: DashboardWorkflowActivationRecord): number {
  const candidate = entry.latest_event_at ?? entry.completed_at ?? entry.started_at ?? entry.queued_at;
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

function readWorkspaceMemoryTraceSummary(workspace?: DashboardWorkspaceRecord): {
  value: string;
  detail: string;
} {
  const memory = asRecord(workspace?.memory);
  const operatorKeys = Object.keys(memory).filter((key) => !WORKSPACE_MEMORY_TRACE_KEYS.has(key));
  const hasTimelinePackets =
    memory.workspace_timeline !== undefined || memory.last_run_summary !== undefined;

  if (operatorKeys.length > 0) {
    return {
      value: `${operatorKeys.length} keys`,
      detail: 'Workspace memory includes operator-visible handoff keys alongside the run timeline packets.',
    };
  }
  if (hasTimelinePackets) {
    return {
      value: 'Timeline ready',
      detail: 'Workspace memory already carries the run summary and timeline packets for cross-run inspection.',
    };
  }
  return {
    value: 'Not recorded',
    detail: 'No workspace memory handoff packets are available for this workflow yet.',
  };
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

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function humanizeToken(value: string | null | undefined): string {
  if (!value) {
    return 'Unknown';
  }
  return value.replace(/[_-]+/g, ' ').trim();
}
