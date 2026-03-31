import type {
  MissionControlAttentionItem,
  MissionControlLiveSection,
  MissionControlOutputDescriptor,
  MissionControlOutputStatus,
  MissionControlReadModelVersion,
  MissionControlWorkflowCard,
} from '../types.js';
import type {
  ArtifactOutputRow,
  WorkflowRow,
  WorkflowSignalRow,
} from './types.js';
import { deriveMissionControlPosture } from '../posture.js';
import { deriveWorkflowActionAvailability } from '../action-availability.js';

export function normalizeLifecycleFilter(
  value: 'all' | 'ongoing' | 'planned' | undefined,
): 'all' | 'ongoing' | 'planned' {
  if (value === 'ongoing' || value === 'planned') {
    return value;
  }
  return 'all';
}

export function buildWorkflowCard(
  workflow: WorkflowRow,
  signals: WorkflowSignalRow,
  outputs: MissionControlOutputDescriptor[],
  version: MissionControlReadModelVersion,
): MissionControlWorkflowCard {
  const hasPauseRequest = hasWorkflowMarker(workflow.metadata, 'pause_requested_at');
  const hasCancelRequest = hasWorkflowMarker(workflow.metadata, 'cancel_requested_at');
  const posture = deriveMissionControlPosture({
    workflowState: workflow.state,
    hasPauseRequest,
    hasCancelRequest,
    waitingForDecisionCount: signals.waiting_for_decision_count,
    openEscalationCount: signals.open_escalation_count,
    blockedWorkItemCount: signals.blocked_work_item_count,
    failedTaskCount: signals.failed_task_count,
    recoverableIssueCount: signals.recoverable_issue_count,
    activeTaskCount: signals.active_task_count,
    activeWorkItemCount: signals.active_work_item_count,
    pendingWorkItemCount: signals.pending_work_item_count,
    recentOutputCount: outputs.length,
    currentActivitySummary: outputs[0] ? `${outputs[0].title} updated` : readActivitySummary(workflow, signals),
    waitingReason: signals.waiting_for_decision_count > 0 ? 'Waiting on operator decisions' : null,
    blockerReason: readBlockerReason(signals),
    updatedAt: toIsoString(workflow.updated_at),
  });

  return {
    id: workflow.id,
    name: workflow.name,
    state: workflow.state,
    lifecycle: workflow.lifecycle,
    currentStage: workflow.current_stage,
    workspaceId: workflow.workspace_id,
    workspaceName: workflow.workspace_name,
    playbookId: workflow.playbook_id,
    playbookName: workflow.playbook_name,
    posture: posture.posture,
    attentionLane: posture.attentionLane,
    pulse: posture.pulse,
    outputDescriptors: outputs,
    availableActions: deriveWorkflowActionAvailability({
      workflowState: workflow.state,
      posture: posture.posture,
      hasCancelRequest,
      version: {
        readModelEventId: version.latestEventId,
        latestEventId: version.latestEventId,
      },
    }),
    metrics: {
      activeTaskCount: signals.active_task_count,
      activeWorkItemCount: signals.active_work_item_count,
      blockedWorkItemCount: signals.blocked_work_item_count,
      openEscalationCount: signals.open_escalation_count,
      waitingForDecisionCount: signals.waiting_for_decision_count,
      failedTaskCount: signals.failed_task_count,
      recoverableIssueCount: signals.recoverable_issue_count,
      lastChangedAt: toIsoString(workflow.updated_at),
    },
    version,
  };
}

export function buildWorkflowCardSections(
  workflows: MissionControlWorkflowCard[],
): MissionControlLiveSection[] {
  return [
    buildSection('needs_action', 'Needs Action', workflows.filter((row) => row.posture === 'needs_decision')),
    buildSection('at_risk', 'At Risk', workflows.filter((row) => ['needs_intervention', 'recoverable_needs_steering', 'terminal_failed'].includes(row.posture))),
    buildSection('progressing', 'Progressing', workflows.filter((row) => row.posture === 'progressing')),
    buildSection('waiting', 'Waiting', workflows.filter((row) => row.posture === 'waiting_by_design' || row.posture === 'paused' || row.posture === 'cancelling')),
    buildSection('recently_changed', 'Recently Changed', workflows.filter((row) => row.posture === 'completed' || row.posture === 'cancelled')),
  ].filter((section) => section.count > 0);
}

export function buildAttentionItems(
  workflows: MissionControlWorkflowCard[],
): MissionControlAttentionItem[] {
  return workflows
    .filter((workflow) => workflow.attentionLane !== 'watchlist')
    .map((workflow) => ({
      id: `attention:${workflow.id}`,
      lane: workflow.attentionLane,
      title: workflow.posture === 'needs_decision' ? 'Decision required' : 'Operator attention required',
      workflowId: workflow.id,
      summary: workflow.pulse.summary,
    }));
}

export function resolveArtifactOutputStatus(row: ArtifactOutputRow): MissionControlOutputStatus {
  if (readOptionalString(row.workflow_state) === 'completed' || row.work_item_completed_at != null) {
    return 'final';
  }
  const taskState = readOptionalString(row.task_state);
  if (taskState === 'output_pending_assessment' || taskState === 'awaiting_approval') {
    return 'under_review';
  }
  if (taskState === 'completed') {
    return 'approved';
  }
  return 'draft';
}

export function emptySignals(workflowId: string): WorkflowSignalRow {
  return {
    workflow_id: workflowId,
    waiting_for_decision_count: 0,
    open_escalation_count: 0,
    blocked_work_item_count: 0,
    failed_task_count: 0,
    active_task_count: 0,
    active_work_item_count: 0,
    pending_work_item_count: 0,
    recoverable_issue_count: 0,
  };
}

export function pushOutput(
  outputs: Map<string, MissionControlOutputDescriptor[]>,
  workflowId: string,
  descriptor: MissionControlOutputDescriptor,
): void {
  const current = outputs.get(workflowId) ?? [];
  current.push(descriptor);
  outputs.set(workflowId, current);
}

function buildSection(
  id: MissionControlLiveSection['id'],
  title: string,
  workflows: MissionControlWorkflowCard[],
): MissionControlLiveSection {
  return { id, title, count: workflows.length, workflows };
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readActivitySummary(workflow: WorkflowRow, signals: WorkflowSignalRow): string | null {
  if (workflow.current_stage) return `Active work in ${workflow.current_stage}`;
  if (signals.active_work_item_count === 0 && signals.active_task_count > 0) {
    if (signals.pending_work_item_count > 0) {
      return 'Routing new work';
    }
    return 'Orchestrating the next step';
  }
  if (signals.active_work_item_count > 0) return 'Active work is progressing';
  if (signals.active_task_count > 0) return 'Workflow activity is progressing';
  return null;
}

function readBlockerReason(signals: WorkflowSignalRow): string | null {
  if (signals.open_escalation_count > 0) return `${signals.open_escalation_count} escalations are still open`;
  if (signals.blocked_work_item_count > 0) return `${signals.blocked_work_item_count} work items are blocked`;
  if (signals.failed_task_count > 0) return `${signals.failed_task_count} tasks have failed`;
  return null;
}

function toIsoString(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function hasWorkflowMarker(metadata: Record<string, unknown> | null, key: string): boolean {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0;
}
