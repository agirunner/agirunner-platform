import type {
  WorkflowInterventionRecord,
} from '../workflow-intervention-service.js';
import type { WorkflowNeedsActionItem } from '../workflow-operations-types.js';
import type { WorkflowBoardNeedsActionItem } from './workflow-workspace-types.js';
import {
  humanizeGateStatus,
  isBlockedGateStatus,
  readOptionalString,
} from './workflow-workspace-common.js';

export function readBoardNeedsActionItems(board: Record<string, unknown>): WorkflowBoardNeedsActionItem[] {
  const workItems = Array.isArray(board.work_items) ? board.work_items : [];
  const items: WorkflowBoardNeedsActionItem[] = [];
  for (const workItem of workItems) {
    if (!workItem || typeof workItem !== 'object' || Array.isArray(workItem)) {
      continue;
    }
    const record = workItem as Record<string, unknown>;
    const workItemId = readOptionalString(record.id);
    if (!workItemId) {
      continue;
    }
    const title = readOptionalString(record.title) ?? 'Work item';
    const gateStatus = readOptionalString(record.gate_status);
    const escalationStatus = readOptionalString(record.escalation_status);
    const blockedState = readOptionalString(record.blocked_state);
    if (gateStatus === 'awaiting_approval') {
      items.push({
        action_id: `${workItemId}:awaiting_approval`,
        action_kind: 'review_work_item',
        label: 'Approval required',
        summary: `${title} is waiting for operator approval.`,
        subject_label: title,
        target: { target_kind: 'work_item', target_id: workItemId },
        stage_name: readOptionalString(record.stage_name) ?? null,
        priority: 'high',
        requires_confirmation: true,
        submission: { route_kind: 'workflow_intervention', method: 'POST' },
        responses: [],
      });
    }
    if (escalationStatus === 'open') {
      items.push({
        action_id: `${workItemId}:open_escalation`,
        action_kind: 'resolve_escalation',
        label: 'Resolve escalation',
        summary: `${title} has an open escalation.`,
        subject_label: title,
        target: { target_kind: 'work_item', target_id: workItemId },
        stage_name: readOptionalString(record.stage_name) ?? null,
        priority: 'high',
        requires_confirmation: false,
        submission: { route_kind: 'workflow_intervention', method: 'POST' },
        responses: [],
      });
    }
    if (blockedState === 'blocked') {
      items.push({
        action_id: `${workItemId}:blocked`,
        action_kind: 'unblock_work_item',
        label: 'Unblock work item',
        summary: buildBlockedSummary(title, record),
        subject_label: title,
        target: { target_kind: 'work_item', target_id: workItemId },
        stage_name: readOptionalString(record.stage_name) ?? null,
        priority: 'high',
        requires_confirmation: false,
        submission: { route_kind: 'workflow_intervention', method: 'POST' },
        responses: [],
      });
      continue;
    }
    if (isBlockedGateStatus(gateStatus)) {
      items.push({
        action_id: `${workItemId}:${gateStatus}`,
        action_kind: 'unblock_work_item',
        label: gateStatus === 'request_changes' || gateStatus === 'changes_requested'
          ? 'Address requested changes'
          : gateStatus === 'rejected'
            ? 'Resolve rejection'
            : 'Unblock work item',
        summary: buildBlockedSummary(title, record),
        subject_label: title,
        target: { target_kind: 'work_item', target_id: workItemId },
        stage_name: readOptionalString(record.stage_name) ?? null,
        priority: 'high',
        requires_confirmation: false,
        submission: { route_kind: 'workflow_intervention', method: 'POST' },
        responses: [],
      });
    }
  }
  return items;
}

export function readBoardStageNeedsActionItems(
  board: Record<string, unknown>,
  workflowId: string,
): WorkflowBoardNeedsActionItem[] {
  const stageSummary = Array.isArray(board.stage_summary) ? board.stage_summary : [];
  const actionableWorkItemStages = readActionableWorkItemStages(board);
  const items: WorkflowBoardNeedsActionItem[] = [];
  for (const stage of stageSummary) {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
      continue;
    }
    const record = stage as Record<string, unknown>;
    const stageName = readOptionalString(record.name);
    const gateStatus = readOptionalString(record.gate_status);
    if (!stageName || !gateStatus || actionableWorkItemStages.has(stageName)) {
      continue;
    }
    if (gateStatus === 'awaiting_approval') {
      items.push({
        action_id: `stage:${stageName}:awaiting_approval`,
        action_kind: 'review_stage_gate',
        label: 'Approval required',
        summary: `Stage ${stageName} is waiting for operator approval.`,
        target: { target_kind: 'workflow', target_id: workflowId },
        stage_name: stageName,
        priority: 'high',
        requires_confirmation: true,
        submission: { route_kind: 'workflow_intervention', method: 'POST' },
        responses: [],
      });
      continue;
    }
    if (['blocked', 'changes_requested', 'rejected'].includes(gateStatus)) {
      items.push({
        action_id: `stage:${stageName}:${gateStatus}`,
        action_kind: 'resolve_stage_gate',
        label: 'Stage requires intervention',
        summary: `Stage ${stageName} is ${humanizeGateStatus(gateStatus)} and needs operator intervention.`,
        target: { target_kind: 'workflow', target_id: workflowId },
        stage_name: stageName,
        priority: 'high',
        requires_confirmation: false,
        submission: { route_kind: 'workflow_intervention', method: 'POST' },
        responses: [],
      });
    }
  }
  return items;
}

export function isActionableGateStatus(status: string): boolean {
  return status === 'awaiting_approval'
    || status === 'changes_requested'
    || status === 'blocked'
    || status === 'rejected';
}

export function readStructuredActionKind(intervention: WorkflowInterventionRecord): string | null {
  const value = intervention.structured_action?.kind;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function readInterventionTarget(
  intervention: WorkflowInterventionRecord,
  workflowId: string,
): WorkflowNeedsActionItem['target'] {
  if (typeof intervention.task_id === 'string' && intervention.task_id.trim().length > 0) {
    return {
      target_kind: 'task',
      target_id: intervention.task_id,
    };
  }
  if (typeof intervention.work_item_id === 'string' && intervention.work_item_id.trim().length > 0) {
    return {
      target_kind: 'work_item',
      target_id: intervention.work_item_id,
    };
  }
  return {
    target_kind: 'workflow',
    target_id: workflowId,
  };
}

function readActionableWorkItemStages(board: Record<string, unknown>): Set<string> {
  const workItems = Array.isArray(board.work_items) ? board.work_items : [];
  const stages = new Set<string>();
  for (const workItem of workItems) {
    if (!workItem || typeof workItem !== 'object' || Array.isArray(workItem)) {
      continue;
    }
    const record = workItem as Record<string, unknown>;
    const stageName = readOptionalString(record.stage_name);
    const gateStatus = readOptionalString(record.gate_status);
    const escalationStatus = readOptionalString(record.escalation_status);
    const blockedState = readOptionalString(record.blocked_state);
    if (!stageName) {
      continue;
    }
    if (
      gateStatus === 'awaiting_approval'
      || escalationStatus === 'open'
      || blockedState === 'blocked'
      || isBlockedGateStatus(gateStatus)
    ) {
      stages.add(stageName);
    }
  }
  return stages;
}

function buildBlockedSummary(title: string, record: Record<string, unknown>): string {
  const blockedReason =
    readOptionalString(record.blocked_reason) ?? readOptionalString(record.gate_decision_feedback);
  if (blockedReason) {
    return `${title} is blocked: ${blockedReason}`;
  }
  return `${title} is blocked and needs operator intervention.`;
}
