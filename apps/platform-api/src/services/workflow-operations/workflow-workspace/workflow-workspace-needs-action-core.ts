import type {
  WorkflowInterventionRecord,
} from '../../workflow-intervention-service.js';
import type {
  WorkflowNeedsActionDetail,
  WorkflowNeedsActionItem,
  WorkflowWorkspacePacket,
} from '../workflow-operations-types.js';
import type {
  ActionableTaskRecord,
  WorkflowBoardNeedsActionItem,
  WorkflowGateRecord,
} from './workflow-workspace-types.js';
import {
  ensureSentence,
  humanizeActionKind,
  humanizeToken,
  summarizeConcerns,
} from './workflow-workspace-common.js';
import {
  readBoardNeedsActionItems,
  readBoardStageNeedsActionItems,
  readInterventionTarget,
  readStructuredActionKind,
} from './workflow-workspace-needs-action-board.js';
import {
  buildBoardNeedsActionResponses,
  buildInterventionResponses,
  compareNeedsActionPriority,
  isActionableIntervention,
  shouldPublishNeedsActionItem,
  shouldSuppressStaleBoardNeedsActionItem,
} from './workflow-workspace-needs-action-responses.js';

export function buildNeedsActionPacket(
  items: WorkflowNeedsActionItem[],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): WorkflowWorkspacePacket['needs_action'] {
  const visibleItems = filterNeedsActionItemsForSelectedScope(items, selectedScope);
  return {
    items: visibleItems,
    total_count: visibleItems.length,
    default_sort: 'priority_desc',
    scope_summary: {
      workflow_total_count: items.length,
      selected_scope_total_count: visibleItems.length,
      scoped_away_workflow_count: countScopedAwayWorkflowActions(items, visibleItems, selectedScope),
    },
  };
}

export function buildNeedsActionItems(
  workflowId: string,
  board: Record<string, unknown>,
  interventions: WorkflowInterventionRecord[],
  actionableTasks: ActionableTaskRecord[],
  gates: WorkflowGateRecord[],
): WorkflowNeedsActionItem[] {
  const items: WorkflowNeedsActionItem[] = [];
  const actionableTaskMap = buildActionableTaskMap(actionableTasks);
  const gatesByWorkItem = buildWorkflowGateWorkItemMap(gates);
  const gatesByStage = buildWorkflowGateStageMap(gates);
  for (const boardItem of readBoardNeedsActionItems(board)) {
    const gate = resolveNeedsActionGate(boardItem, gatesByWorkItem, gatesByStage);
    const directTask = readDirectActionTask(
      boardItem.action_kind,
      boardItem.target.target_kind,
      boardItem.target.target_id,
      actionableTaskMap,
    );
    const responses = buildBoardNeedsActionResponses(boardItem.action_kind, boardItem.target, directTask, gate);
    if (shouldSuppressStaleBoardNeedsActionItem(boardItem.action_kind, responses)) {
      continue;
    }
    const presentation = buildBoardNeedsActionPresentation(boardItem, directTask, gate);
    const { stage_name: _stageName, subject_label: _subjectLabel, ...publicItem } = boardItem;
    const item: WorkflowNeedsActionItem = {
      ...publicItem,
      ...presentation,
      work_item_id: directTask?.work_item_id ?? readNeedsActionWorkItemId(boardItem.target),
      task_id: directTask?.id ?? readNeedsActionTaskId(boardItem.target),
      target: directTask ? { target_kind: 'task', target_id: directTask.id } : boardItem.target,
      submission: {
        route_kind: directTask ? 'task_mutation' : boardItem.submission.route_kind,
        method: 'POST',
      },
      responses,
    };
    if (shouldPublishNeedsActionItem(item)) {
      items.push(item);
    }
  }
  for (const stageItem of readBoardStageNeedsActionItems(board, workflowId)) {
    if (items.some((item) => item.action_id === stageItem.action_id)) {
      continue;
    }
    const gate = resolveNeedsActionGate(stageItem, gatesByWorkItem, gatesByStage);
    const presentation = buildBoardNeedsActionPresentation(stageItem, null, gate);
    const { stage_name: _stageName, ...publicItem } = stageItem;
    const item: WorkflowNeedsActionItem = {
      ...publicItem,
      ...presentation,
      work_item_id: null,
      task_id: null,
      responses: buildBoardNeedsActionResponses(stageItem.action_kind, stageItem.target, null, gate),
    };
    if (shouldPublishNeedsActionItem(item)) {
      items.push(item);
    }
  }
  for (const intervention of interventions) {
    if (!isActionableIntervention(intervention)) {
      continue;
    }
    const actionKind = readStructuredActionKind(intervention) ?? intervention.kind;
    const target = readInterventionTarget(intervention, workflowId);
    const actionId = `${intervention.id}:${actionKind}:${target.target_id}`;
    if (items.some((item) => item.action_id === actionId)) {
      continue;
    }
    const item: WorkflowNeedsActionItem = {
      action_id: actionId,
      action_kind: actionKind,
      label: humanizeActionKind(actionKind),
      summary: intervention.summary,
      work_item_id: readInterventionWorkItemId(intervention, target),
      task_id: target.target_kind === 'task' ? target.target_id : null,
      target,
      priority: 'high',
      requires_confirmation: false,
      submission: {
        route_kind: target.target_kind === 'task' ? 'task_mutation' : 'workflow_intervention',
        method: 'POST',
      },
      responses: buildInterventionResponses(
        actionKind,
        target,
        typeof intervention.work_item_id === 'string' ? intervention.work_item_id : null,
      ),
    };
    if (shouldPublishNeedsActionItem(item)) {
      items.push(item);
    }
  }
  return items.sort(compareNeedsActionPriority);
}

function filterNeedsActionItemsForSelectedScope(
  items: WorkflowNeedsActionItem[],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): WorkflowNeedsActionItem[] {
  if (selectedScope.scope_kind === 'workflow') {
    return items;
  }
  return items.filter((item) => matchesNeedsActionScope(item, selectedScope));
}

function matchesNeedsActionScope(
  item: WorkflowNeedsActionItem,
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): boolean {
  if (selectedScope.scope_kind === 'selected_task') {
    return item.task_id === selectedScope.task_id;
  }
  return item.work_item_id === selectedScope.work_item_id;
}

function countScopedAwayWorkflowActions(
  allItems: WorkflowNeedsActionItem[],
  visibleItems: WorkflowNeedsActionItem[],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): number {
  if (selectedScope.scope_kind === 'workflow') {
    return 0;
  }
  const visibleActionIds = new Set(visibleItems.map((item) => item.action_id));
  return allItems.filter(
    (item) => item.target.target_kind === 'workflow' && !visibleActionIds.has(item.action_id),
  ).length;
}

function readNeedsActionWorkItemId(target: WorkflowNeedsActionItem['target']): string | null {
  return target.target_kind === 'work_item' ? target.target_id : null;
}

function readNeedsActionTaskId(target: WorkflowNeedsActionItem['target']): string | null {
  return target.target_kind === 'task' ? target.target_id : null;
}

function readInterventionWorkItemId(
  intervention: WorkflowInterventionRecord,
  target: WorkflowNeedsActionItem['target'],
): string | null {
  if (typeof intervention.work_item_id === 'string') {
    return intervention.work_item_id;
  }
  return readNeedsActionWorkItemId(target);
}

function buildActionableTaskMap(tasks: ActionableTaskRecord[]): Map<string, ActionableTaskRecord[]> {
  const taskMap = new Map<string, ActionableTaskRecord[]>();
  for (const task of tasks) {
    if (!task.work_item_id) {
      continue;
    }
    const entries = taskMap.get(task.work_item_id) ?? [];
    entries.push(task);
    taskMap.set(task.work_item_id, entries);
  }
  return taskMap;
}

function readDirectActionTask(
  actionKind: string,
  targetKind: WorkflowNeedsActionItem['target']['target_kind'],
  targetId: string,
  actionableTaskMap: Map<string, ActionableTaskRecord[]>,
): ActionableTaskRecord | null {
  if (targetKind === 'task') {
    for (const tasks of actionableTaskMap.values()) {
      const directTask = tasks.find((task) => task.id === targetId);
      if (directTask) {
        return directTask;
      }
    }
    return null;
  }
  if (targetKind !== 'work_item') {
    return null;
  }
  const tasks = actionableTaskMap.get(targetId) ?? [];
  const preferredStates = readPreferredActionTaskStates(actionKind);
  for (const state of preferredStates) {
    const matchingTask = tasks.find((task) => task.state === state);
    if (matchingTask) {
      return matchingTask;
    }
  }
  return tasks[0] ?? null;
}

function readPreferredActionTaskStates(actionKind: string): string[] {
  if (actionKind === 'resolve_escalation') {
    return ['escalated'];
  }
  if (actionKind === 'review_work_item') {
    return ['awaiting_approval', 'output_pending_assessment'];
  }
  return [];
}

function buildBoardNeedsActionPresentation(
  item: WorkflowBoardNeedsActionItem,
  directTask: ActionableTaskRecord | null,
  gate: WorkflowGateRecord | null,
): Pick<WorkflowNeedsActionItem, 'summary' | 'details'> {
  if (item.action_kind === 'resolve_escalation' && directTask) {
    return buildEscalationPresentation(item, directTask);
  }
  if ((item.action_kind === 'review_work_item' || item.action_kind === 'review_stage_gate') && directTask) {
    return buildTaskApprovalPresentation(item, directTask);
  }
  if ((item.action_kind === 'review_work_item' || item.action_kind === 'review_stage_gate') && gate?.status === 'awaiting_approval') {
    return buildGateApprovalPresentation(item, gate);
  }
  return { summary: item.summary };
}

function buildEscalationPresentation(
  item: WorkflowBoardNeedsActionItem,
  directTask: ActionableTaskRecord,
): Pick<WorkflowNeedsActionItem, 'summary' | 'details'> {
  const title = item.subject_label ?? 'Work item';
  const reason = directTask.escalation_reason;
  const details = buildEscalationContextDetails(directTask.escalation_context_packet);
  if (directTask.escalation_context) {
    details.push({ label: 'Context', value: directTask.escalation_context });
  }
  if (directTask.escalation_work_so_far) {
    details.push({ label: 'Work so far', value: directTask.escalation_work_so_far });
  }
  return {
    summary: reason
      ? `${title} needs escalation resolution: ${ensureSentence(reason)}`
      : `${title} has an open escalation.`,
    ...(details.length > 0 ? { details } : {}),
  };
}

function buildEscalationContextDetails(packet: Record<string, unknown> | null): WorkflowNeedsActionDetail[] {
  if (!packet) {
    return [];
  }

  const details: WorkflowNeedsActionDetail[] = [];
  const conflictingRequestIds = (packet.conflicting_request_ids ?? {}) as Record<string, unknown>;
  const submittedRequestId = typeof conflictingRequestIds.submitted_request_id === 'string'
    ? conflictingRequestIds.submitted_request_id
    : null;
  const persistedRequestId = typeof conflictingRequestIds.persisted_request_id === 'string'
    ? conflictingRequestIds.persisted_request_id
    : null;
  const currentAttemptRequestId = typeof conflictingRequestIds.current_attempt_request_id === 'string'
    ? conflictingRequestIds.current_attempt_request_id
    : null;
  const requestIdSummary = [
    submittedRequestId ? `Submitted ${submittedRequestId}` : null,
    persistedRequestId ? `persisted ${persistedRequestId}` : null,
    currentAttemptRequestId ? `current attempt ${currentAttemptRequestId}` : null,
  ].filter((value): value is string => value !== null);
  if (requestIdSummary.length > 0) {
    details.push({
      label: 'Conflicting request ids',
      value: requestIdSummary.join('; '),
    });
  }

  const existingHandoff = (packet.existing_handoff ?? {}) as Record<string, unknown>;
  const handoffSummary = typeof existingHandoff.summary === 'string' ? existingHandoff.summary : null;
  if (handoffSummary) {
    const qualifiers = [
      typeof existingHandoff.request_id === 'string' ? existingHandoff.request_id : null,
      typeof existingHandoff.completion_state === 'string'
        ? existingHandoff.completion_state
        : typeof existingHandoff.decision_state === 'string'
          ? existingHandoff.decision_state
          : null,
    ].filter((value): value is string => value !== null);
    details.push({
      label: 'Persisted handoff',
      value: qualifiers.length > 0 ? `${handoffSummary} (${qualifiers.join(', ')})` : handoffSummary,
    });
  }

  if (packet.task_contract_satisfied_by_persisted_handoff === true) {
    details.push({
      label: 'Completion contract',
      value: 'Already satisfied by the persisted handoff.',
    });
  }

  return details;
}

function buildTaskApprovalPresentation(
  item: WorkflowBoardNeedsActionItem,
  directTask: ActionableTaskRecord,
): Pick<WorkflowNeedsActionItem, 'summary' | 'details'> {
  const title = item.subject_label ?? 'Work item';
  const isOutputReview = directTask.state === 'output_pending_assessment';
  const details: WorkflowNeedsActionDetail[] = [
    {
      label: isOutputReview ? 'Assessment target' : 'Approval target',
      value: directTask.title,
    },
  ];
  if (directTask.description) {
    details.push({ label: 'Context', value: directTask.description });
  }
  if (directTask.review_feedback) {
    details.push({ label: 'Latest feedback', value: directTask.review_feedback });
  }
  if (directTask.verification_summary) {
    details.push({ label: 'Verification', value: directTask.verification_summary });
  }
  if (directTask.subject_revision !== null) {
    details.push({ label: 'Revision', value: String(directTask.subject_revision) });
  }

  return {
    summary: isOutputReview
      ? `${title} is waiting for output review on ${directTask.title}.`
      : `${title} is waiting for operator approval on ${directTask.title}.`,
    ...(details.length > 0 ? { details } : {}),
  };
}

function buildGateApprovalPresentation(
  item: WorkflowBoardNeedsActionItem,
  gate: WorkflowGateRecord,
): Pick<WorkflowNeedsActionItem, 'summary' | 'details'> {
  const title = item.subject_label ?? gate.requested_by_work_item_title ?? (item.stage_name ? `Stage ${item.stage_name}` : 'Approval');
  const details: WorkflowNeedsActionDetail[] = [];
  if (gate.recommendation) {
    details.push({ label: 'Recommendation', value: humanizeToken(gate.recommendation) });
  }
  const requestedBy = gate.requested_by_task_title ?? gate.requested_by_work_item_title;
  if (requestedBy) {
    details.push({ label: 'Requested by', value: requestedBy });
  }
  const concernsSummary = summarizeConcerns(gate.concerns);
  if (concernsSummary) {
    details.push({ label: 'Concerns', value: concernsSummary });
  }

  return {
    summary: gate.request_summary
      ? `${title} is waiting for operator approval: ${ensureSentence(gate.request_summary)}`
      : item.summary,
    ...(details.length > 0 ? { details } : {}),
  };
}

function buildWorkflowGateWorkItemMap(gates: WorkflowGateRecord[]): Map<string, WorkflowGateRecord> {
  const gateMap = new Map<string, WorkflowGateRecord>();
  for (const gate of gates) {
    if (!gate.requested_by_work_item_id || gateMap.has(gate.requested_by_work_item_id)) {
      continue;
    }
    gateMap.set(gate.requested_by_work_item_id, gate);
  }
  return gateMap;
}

function buildWorkflowGateStageMap(gates: WorkflowGateRecord[]): Map<string, WorkflowGateRecord> {
  const gateMap = new Map<string, WorkflowGateRecord>();
  for (const gate of gates) {
    if (gateMap.has(gate.stage_name)) {
      continue;
    }
    gateMap.set(gate.stage_name, gate);
  }
  return gateMap;
}

function resolveNeedsActionGate(
  item: WorkflowBoardNeedsActionItem,
  gatesByWorkItem: Map<string, WorkflowGateRecord>,
  gatesByStage: Map<string, WorkflowGateRecord>,
): WorkflowGateRecord | null {
  if (item.target.target_kind === 'work_item') {
    const workItemGate = gatesByWorkItem.get(item.target.target_id);
    if (workItemGate) {
      return workItemGate;
    }
  }
  if (item.stage_name) {
    return gatesByStage.get(item.stage_name) ?? null;
  }
  return null;
}
