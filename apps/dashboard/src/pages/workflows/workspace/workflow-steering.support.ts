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
    const selectedTaskName =
      input.selectedTaskTitle
      ?? input.selectedTask?.title
      ?? input.scope.name
      ?? 'Selected task';
    return [
      buildTaskTargetOption(
        input.selectedWorkItemId ?? input.selectedTask?.work_item_id ?? null,
        input.selectedTaskId ?? input.selectedTask?.id ?? null,
        selectedTaskName,
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

  const workflowScopeTaskTargets = buildWorkflowScopeTaskTargets(input);
  if (workflowScopeTaskTargets.length > 0) {
    options.push(...workflowScopeTaskTargets);
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
    const scopedTask =
      input.selectedTask?.id === input.target.taskId
        ? input.selectedTask
        : input.selectedWorkItemTasks.find((task) => task.id === input.target.taskId) ?? null;
    if (scopedTask && isPausedTask(scopedTask)) {
      return 'This task is paused. Resume it or choose another target before steering.';
    }
    if (scopedTask && isTerminalTask(scopedTask)) {
      return 'This task is already completed or cancelled. Historical work cannot be steered.';
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
    return `Steering attachments for task: ${target.name}`;
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

function buildTaskTargetOption(
  workItemId: string | null,
  taskId: string | null,
  name: string,
): WorkflowSteeringTargetOption {
  return {
    value: `task:${taskId ?? 'current'}`,
    scopeKind: 'selected_task',
    subject: 'task',
    name,
    label: `Task: ${name}`,
    banner: `Task: ${name}`,
    workItemId,
    taskId,
  };
}

function buildWorkflowScopeTaskTargets(
  input: WorkflowSteeringTargetContext,
): WorkflowSteeringTargetOption[] {
  if (hasWorkflowDisabledTargets(input.workflowState) || !input.selectedWorkItemId) {
    return [];
  }
  return input.selectedWorkItemTasks
    .filter((task) => !isPausedTask(task) && !isTerminalTask(task))
    .map((task) =>
      buildTaskTargetOption(
        task.work_item_id ?? input.selectedWorkItemId ?? null,
        task.id,
        task.title ?? 'Selected task',
      ),
    );
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

function isPausedTask(task: DashboardTaskRecord): boolean {
  return String(task.state) === 'paused';
}

function isTerminalTask(task: DashboardTaskRecord): boolean {
  return task.state === 'completed' || task.state === 'cancelled';
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
