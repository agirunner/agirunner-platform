import type {
  DashboardTaskRecord,
  DashboardWorkflowBoardColumn,
  DashboardWorkflowSteeringRequestInput,
  DashboardWorkflowWorkItemRecord,
} from '../../../lib/api.js';
import type { WorkflowWorkbenchScopeDescriptor } from '../workflows-page.support.js';

export interface WorkflowSteeringTargetOption {
  value: string;
  scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind'];
  subject: WorkflowWorkbenchScopeDescriptor['subject'];
  name: string;
  label: string;
  banner: string;
  workItemId: string | null;
  taskId: string | null;
}

export interface WorkflowSteeringTargetContext {
  workflowName: string;
  workflowState: string;
  boardColumns: DashboardWorkflowBoardColumn[];
  scope: WorkflowWorkbenchScopeDescriptor;
  selectedWorkItemId: string | null;
  selectedWorkItemTitle: string | null;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
  selectedTaskId: string | null;
  selectedTaskTitle: string | null;
  selectedTask: DashboardTaskRecord | null;
  selectedWorkItemTasks: DashboardTaskRecord[];
}

export function buildWorkflowSteeringTargets(
  input: WorkflowSteeringTargetContext,
): WorkflowSteeringTargetOption[] {
  if (input.scope.scopeKind === 'selected_task') {
    const selectedWorkItemName =
      input.selectedWorkItemTitle
      ?? input.selectedWorkItem?.title
      ?? input.selectedTask?.work_item_title
      ?? 'Selected work item';
    return [
      buildScopedWorkItemTargetOption(
        input.selectedWorkItemId ?? input.selectedTask?.work_item_id ?? null,
        selectedWorkItemName,
      ),
    ];
  }
  if (input.scope.scopeKind === 'selected_work_item') {
    return [
      buildWorkItemTargetOption(
        input.selectedWorkItemId,
        input.selectedWorkItemTitle ?? input.scope.name,
      ),
    ];
  }

  const options: WorkflowSteeringTargetOption[] = [
    {
      value: 'workflow',
      scopeKind: 'workflow',
      subject: 'workflow',
      name: input.workflowName,
      label: `Workflow: ${input.workflowName}`,
      banner: `Workflow: ${input.workflowName}`,
      workItemId: null,
      taskId: null,
    },
  ];

  if (
    shouldIncludeWorkflowScopeWorkItemTarget(
      input.selectedWorkItemId,
      input.selectedWorkItem,
      input.workflowState,
      input.boardColumns,
    )
  ) {
    options.push(
      buildWorkItemTargetOption(
        input.selectedWorkItemId,
        input.selectedWorkItemTitle ?? input.selectedWorkItem?.title ?? 'Selected work item',
      ),
    );
  }

  return options;
}

export function buildWorkflowSteeringRequestInput(input: {
  requestId: string;
  request: string;
  sessionId: string | null;
  target: WorkflowSteeringTargetOption;
  linkedInputPacketIds?: string[];
}): DashboardWorkflowSteeringRequestInput {
  return {
    request_id: input.requestId,
    request: input.request,
    work_item_id: input.target.workItemId ?? undefined,
    task_id: input.target.taskId ?? undefined,
    linked_input_packet_ids: input.linkedInputPacketIds ?? [],
    session_id: input.sessionId ?? undefined,
  };
}

export function describeSteeringTargetDisabledReason(input: {
  workflowState: string;
  boardColumns: DashboardWorkflowBoardColumn[];
  target: WorkflowSteeringTargetOption;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
  selectedTask: DashboardTaskRecord | null;
  selectedWorkItemTasks: DashboardTaskRecord[];
}): string | null {
  if (input.target.scopeKind === 'selected_task') {
    if (input.selectedWorkItem) {
      if (isPausedWorkItem(input.workflowState, input.selectedWorkItem, input.boardColumns)) {
        return 'This work item is paused. Resume it or choose another target before steering.';
      }
      if (isTerminalWorkItem(input.selectedWorkItem, input.boardColumns)) {
        return 'This work item is already completed or cancelled. Historical work cannot be steered.';
      }
    }
    return describeWorkflowTargetDisabledReason(input.workflowState);
  }

  if (input.target.scopeKind === 'selected_work_item' && input.selectedWorkItem) {
    if (isPausedWorkItem(input.workflowState, input.selectedWorkItem, input.boardColumns)) {
      return 'This work item is paused. Resume it or choose another target before steering.';
    }
    if (isTerminalWorkItem(input.selectedWorkItem, input.boardColumns)) {
      return 'This work item is already completed or cancelled. Historical work cannot be steered.';
    }
    return describeWorkflowTargetDisabledReason(input.workflowState);
  }

  return describeWorkflowTargetDisabledReason(input.workflowState);
}

export function buildSteeringAttachmentSummary(target: WorkflowSteeringTargetOption): string {
  if (target.scopeKind === 'selected_task') {
    return `Steering attachments for work item: ${target.name}`;
  }
  if (target.scopeKind === 'selected_work_item') {
    return `Steering attachments for work item: ${target.name}`;
  }
  return `Steering attachments for workflow: ${target.name}`;
}

export function getWorkflowSteeringDisabledReason(input: {
  canAcceptRequest: boolean;
  workflowState: string;
  boardColumns: DashboardWorkflowBoardColumn[];
  target: WorkflowSteeringTargetOption | null;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
  selectedTask: DashboardTaskRecord | null;
  selectedWorkItemTasks: DashboardTaskRecord[];
}): string | null {
  if (!input.target) {
    return input.canAcceptRequest
      ? 'Choose a steering target before recording a request.'
      : describeWorkflowTargetDisabledReason(input.workflowState)
        ?? 'Steering requests are unavailable for this workflow right now.';
  }
  const targetDisabledReason = describeSteeringTargetDisabledReason({
    workflowState: input.workflowState,
    boardColumns: input.boardColumns,
    target: input.target,
    selectedWorkItem: input.selectedWorkItem,
    selectedTask: input.selectedTask,
    selectedWorkItemTasks: input.selectedWorkItemTasks,
  });
  if (targetDisabledReason) {
    return targetDisabledReason;
  }
  if (!input.canAcceptRequest) {
    return 'Steering requests are unavailable for this workflow right now.';
  }
  return null;
}

function buildWorkItemTargetOption(
  workItemId: string | null,
  name: string,
): WorkflowSteeringTargetOption {
  return {
    value: `work-item:${workItemId ?? 'current'}`,
    scopeKind: 'selected_work_item',
    subject: 'work item',
    name,
    label: `Work item: ${name}`,
    banner: `Work item: ${name}`,
    workItemId,
    taskId: null,
  };
}

function buildScopedWorkItemTargetOption(
  workItemId: string | null,
  name: string,
): WorkflowSteeringTargetOption {
  return {
    value: `work-item:${workItemId ?? 'current'}`,
    scopeKind: 'selected_work_item',
    subject: 'work item',
    name,
    label: `Work item: ${name}`,
    banner: `Work item: ${name}`,
    workItemId,
    taskId: null,
  };
}

function shouldIncludeWorkflowScopeWorkItemTarget(
  selectedWorkItemId: string | null,
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null,
  workflowState: string,
  boardColumns: DashboardWorkflowBoardColumn[],
): boolean {
  if (!selectedWorkItemId) {
    return false;
  }
  if (hasWorkflowDisabledTargets(workflowState)) {
    return false;
  }
  if (!selectedWorkItem) {
    return true;
  }
  return (
    !isPausedWorkItem(workflowState, selectedWorkItem, boardColumns) &&
    !isTerminalWorkItem(selectedWorkItem, boardColumns)
  );
}

function isPausedWorkItem(
  workflowState: string,
  workItem: DashboardWorkflowWorkItemRecord,
  boardColumns: DashboardWorkflowBoardColumn[],
): boolean {
  return workflowState === 'paused' && !isTerminalWorkItem(workItem, boardColumns);
}

function isTerminalWorkItem(
  workItem: DashboardWorkflowWorkItemRecord,
  boardColumns: DashboardWorkflowBoardColumn[],
): boolean {
  if (
    workItem.completed_at ||
    workItem.branch_status === 'completed' ||
    workItem.branch_status === 'terminated'
  ) {
    return true;
  }
  return boardColumns.some((column) => column.id === workItem.column_id && column.is_terminal);
}

function hasWorkflowDisabledTargets(workflowState: string): boolean {
  return describeWorkflowTargetDisabledReason(workflowState) !== null;
}

function describeWorkflowTargetDisabledReason(workflowState: string): string | null {
  const state = workflowState.trim().toLowerCase();
  if (state === 'paused') {
    return 'This workflow is paused. Resume it or choose another target before steering.';
  }
  if (state === 'completed' || state === 'cancelled') {
    return `This workflow is ${state}. Historical work cannot be steered.`;
  }
  return null;
}
