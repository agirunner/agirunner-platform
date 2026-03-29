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
    return [
      buildTaskTargetOption(
        input.selectedTaskId,
        input.selectedTaskTitle ?? input.scope.name,
        input.selectedWorkItemId,
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

  const currentTask = resolveSteeringTaskRecord(
    input.selectedTask,
    input.selectedTaskId,
    input.selectedWorkItemTasks,
  );
  options.push(
    ...buildWorkflowScopeTaskTargets({
      workflowState: input.workflowState,
      selectedTaskId: input.selectedTaskId,
      selectedTaskTitle: input.selectedTaskTitle,
      selectedTask: currentTask,
      selectedWorkItemId: input.selectedWorkItemId,
      selectedWorkItemTasks: input.selectedWorkItemTasks,
    }),
  );

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
  const workflowDisabledReason = describeWorkflowTargetDisabledReason(input.workflowState);
  if (workflowDisabledReason) {
    return workflowDisabledReason;
  }

  if (input.target.scopeKind === 'selected_task') {
    const task = resolveSteeringTaskRecord(
      input.selectedTask,
      input.target.taskId,
      input.selectedWorkItemTasks,
    );
    if (!task) {
      return null;
    }
    if (isPausedTask(task)) {
      return 'This task is paused. Resume it or choose another target before steering.';
    }
    if (isTerminalTask(task)) {
      return 'This task is already completed or cancelled. Historical work cannot be steered.';
    }
    return null;
  }

  if (input.target.scopeKind === 'selected_work_item' && input.selectedWorkItem) {
    if (isPausedWorkItem(input.workflowState, input.selectedWorkItem, input.boardColumns)) {
      return 'This work item is paused. Resume it or choose another target before steering.';
    }
    if (isTerminalWorkItem(input.selectedWorkItem, input.boardColumns)) {
      return 'This work item is already completed or cancelled. Historical work cannot be steered.';
    }
  }

  return null;
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
  if (!input.canAcceptRequest) {
    return 'Steering requests are unavailable for this workflow right now.';
  }
  if (!input.target) {
    return 'Choose a steering target before recording a request.';
  }
  return describeSteeringTargetDisabledReason({
    workflowState: input.workflowState,
    boardColumns: input.boardColumns,
    target: input.target,
    selectedWorkItem: input.selectedWorkItem,
    selectedTask: input.selectedTask,
    selectedWorkItemTasks: input.selectedWorkItemTasks,
  });
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
  taskId: string | null,
  name: string,
  workItemId: string | null,
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

function shouldIncludeWorkflowScopeTaskTarget(
  workflowState: string,
  selectedTaskId: string | null,
  selectedTask: DashboardTaskRecord | null,
): boolean {
  if (!selectedTaskId) {
    return false;
  }
  if (hasWorkflowDisabledTargets(workflowState)) {
    return false;
  }
  if (!selectedTask) {
    return true;
  }
  return !isPausedTask(selectedTask) && !isTerminalTask(selectedTask);
}

function buildWorkflowScopeTaskTargets(input: {
  workflowState: string;
  selectedTaskId: string | null;
  selectedTaskTitle: string | null;
  selectedTask: DashboardTaskRecord | null;
  selectedWorkItemId: string | null;
  selectedWorkItemTasks: DashboardTaskRecord[];
}): WorkflowSteeringTargetOption[] {
  if (hasWorkflowDisabledTargets(input.workflowState)) {
    return [];
  }

  const options = new Map<string, WorkflowSteeringTargetOption>();

  if (
    shouldIncludeWorkflowScopeTaskTarget(
      input.workflowState,
      input.selectedTaskId,
      input.selectedTask,
    )
  ) {
    const taskId = input.selectedTaskId;
    options.set(
      taskId ?? 'selected-task',
      buildTaskTargetOption(
        taskId,
        input.selectedTaskTitle ?? input.selectedTask?.title ?? 'Selected task',
        input.selectedTask?.work_item_id ?? input.selectedWorkItemId,
      ),
    );
  }

  for (const task of input.selectedWorkItemTasks) {
    const taskId = typeof task.id === 'string' ? task.id : null;
    if (!taskId || isPausedTask(task) || isTerminalTask(task)) {
      continue;
    }
    if (
      input.selectedWorkItemId &&
      task.work_item_id &&
      task.work_item_id !== input.selectedWorkItemId
    ) {
      continue;
    }
    options.set(
      taskId,
      buildTaskTargetOption(taskId, task.title, task.work_item_id ?? input.selectedWorkItemId),
    );
  }

  return Array.from(options.values());
}

function resolveSteeringTaskRecord(
  selectedTask: DashboardTaskRecord | null,
  targetTaskId: string | null,
  selectedWorkItemTasks: DashboardTaskRecord[],
): DashboardTaskRecord | null {
  if (selectedTask && selectedTask.id === targetTaskId) {
    return selectedTask;
  }
  return selectedWorkItemTasks.find((task) => task.id === targetTaskId) ?? null;
}

function isPausedTask(task: DashboardTaskRecord): boolean {
  return String(task.state) === 'paused';
}

function isTerminalTask(task: DashboardTaskRecord): boolean {
  const state = String(task.state);
  return (
    Boolean(task.completed_at || task.cancelled_at || task.failed_at) ||
    ['completed', 'done', 'succeeded', 'cancelled', 'failed'].includes(state)
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
