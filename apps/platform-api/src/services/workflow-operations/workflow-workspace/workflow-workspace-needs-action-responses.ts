import type {
  WorkflowInterventionRecord,
} from '../workflow-intervention-service.js';
import type {
  WorkflowNeedsActionItem,
  WorkflowNeedsActionResponseAction,
} from '../workflow-operations-types.js';
import type {
  ActionableTaskRecord,
  WorkflowGateRecord,
} from './workflow-workspace-types.js';

export function buildBoardNeedsActionResponses(
  actionKind: string,
  target: WorkflowNeedsActionItem['target'],
  directTask: ActionableTaskRecord | null,
  gate: WorkflowGateRecord | null,
): WorkflowNeedsActionResponseAction[] {
  if (actionKind === 'review_work_item' && directTask) {
    if (directTask.state === 'output_pending_assessment') {
      return [
        buildNeedsActionResponse(
          'approve_task_output',
          'Approve output',
          directTask.id,
          'task',
          'none',
          false,
          directTask.work_item_id,
        ),
        buildNeedsActionResponse(
          'reject_task',
          'Reject',
          directTask.id,
          'task',
          'feedback',
          true,
          directTask.work_item_id,
        ),
        buildNeedsActionResponse(
          'request_changes_task',
          'Request changes',
          directTask.id,
          'task',
          'feedback',
          true,
          directTask.work_item_id,
        ),
      ];
    }
    return [
      buildNeedsActionResponse(
        'approve_task',
        'Approve',
        directTask.id,
        'task',
        'none',
        false,
        directTask.work_item_id,
      ),
      buildNeedsActionResponse(
        'reject_task',
        'Reject',
        directTask.id,
        'task',
        'feedback',
        true,
        directTask.work_item_id,
      ),
      buildNeedsActionResponse(
        'request_changes_task',
        'Request changes',
        directTask.id,
        'task',
        'feedback',
        true,
        directTask.work_item_id,
      ),
    ];
  }
  if ((actionKind === 'review_work_item' || actionKind === 'review_stage_gate') && gate?.status === 'awaiting_approval') {
    return buildGateDecisionResponses(gate.gate_id);
  }
  if (actionKind === 'resolve_escalation' && directTask) {
    return [
      buildNeedsActionResponse(
        'resolve_escalation',
        'Resume with guidance',
        directTask.id,
        'task',
        'instructions',
        true,
        directTask.work_item_id,
      ),
    ];
  }
  if (actionKind === 'resolve_stage_gate' && gate) {
    return buildGateResolutionResponses(gate);
  }
  if (actionKind === 'unblock_work_item') {
    if (gate?.status === 'changes_requested') {
      return buildGateResolutionResponses(gate);
    }
    return [
      buildNeedsActionResponse('add_work_item', 'Add / Modify Work', target.target_id, target.target_kind, 'none'),
    ];
  }
  return [];
}

export function buildInterventionResponses(
  actionKind: string,
  target: WorkflowNeedsActionItem['target'],
  workItemId: string | null,
): WorkflowNeedsActionResponseAction[] {
  if (actionKind === 'retry_task' && target.target_kind === 'task') {
    return [buildNeedsActionResponse('retry_task', 'Retry task', target.target_id, 'task', 'none')];
  }
  if (actionKind === 'resolve_escalation' && target.target_kind === 'task') {
    return [
      buildNeedsActionResponse(
        'resolve_escalation',
        'Resume with guidance',
        target.target_id,
        'task',
        'instructions',
        true,
        workItemId,
      ),
    ];
  }
  return [];
}

export function shouldSuppressStaleBoardNeedsActionItem(
  actionKind: string,
  responses: WorkflowNeedsActionResponseAction[],
): boolean {
  if (responses.length > 0) {
    return false;
  }
  return actionKind === 'review_work_item'
    || actionKind === 'review_stage_gate'
    || actionKind === 'resolve_escalation';
}

export function shouldPublishNeedsActionItem(item: WorkflowNeedsActionItem): boolean {
  return item.responses.some(isVisibleNeedsActionResponse);
}

export function compareNeedsActionPriority(
  left: WorkflowNeedsActionItem,
  right: WorkflowNeedsActionItem,
): number {
  return readNeedsActionPriorityRank(left.priority) - readNeedsActionPriorityRank(right.priority);
}

export function isActionableIntervention(intervention: WorkflowInterventionRecord): boolean {
  return intervention.status === 'open' || intervention.status === 'pending';
}

function buildGateDecisionResponses(gateId: string): WorkflowNeedsActionResponseAction[] {
  return [
    buildNeedsActionResponse('approve_gate', 'Approve', gateId, 'gate', 'none'),
    buildNeedsActionResponse('reject_gate', 'Reject', gateId, 'gate', 'feedback', true),
    buildNeedsActionResponse('request_changes_gate', 'Request changes', gateId, 'gate', 'feedback', true),
  ];
}

function buildGateResolutionResponses(gate: WorkflowGateRecord): WorkflowNeedsActionResponseAction[] {
  const responses: WorkflowNeedsActionResponseAction[] = [];
  if (gate.status === 'changes_requested') {
    responses.push(buildNeedsActionResponse('approve_gate', 'Approve', gate.gate_id, 'gate', 'none'));
  }
  if (gate.requested_by_work_item_id) {
    responses.push(
      buildNeedsActionResponse('add_work_item', 'Add / Modify Work', gate.requested_by_work_item_id, 'work_item', 'none'),
    );
  }
  return responses;
}

function buildNeedsActionResponse(
  kind: string,
  label: string,
  targetId: string,
  targetKind: WorkflowNeedsActionResponseAction['target']['target_kind'],
  promptKind: WorkflowNeedsActionResponseAction['prompt_kind'],
  requiresConfirmation = false,
  workItemId?: string | null,
): WorkflowNeedsActionResponseAction {
  return {
    action_id: `${targetId}:${kind}`,
    kind,
    label,
    work_item_id: workItemId,
    target: {
      target_kind: targetKind,
      target_id: targetId,
    },
    requires_confirmation: requiresConfirmation,
    prompt_kind: promptKind,
  };
}

function isVisibleNeedsActionResponse(action: WorkflowNeedsActionResponseAction): boolean {
  return action.kind === 'approve_task'
    || action.kind === 'approve_task_output'
    || action.kind === 'approve_gate'
    || action.kind === 'reject_task'
    || action.kind === 'reject_gate'
    || action.kind === 'request_changes_task'
    || action.kind === 'request_changes_gate'
    || action.kind === 'resolve_escalation';
}

function readNeedsActionPriorityRank(priority: WorkflowNeedsActionItem['priority']): number {
  switch (priority) {
    case 'high':
      return 0;
    case 'medium':
      return 1;
    default:
      return 2;
  }
}
