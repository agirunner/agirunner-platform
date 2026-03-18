export interface LogScope {
  workspaceId?: string;
  workflowId?: string;
  taskId?: string;
  workItemId?: string;
  activationId?: string;
}

export function applyLogScope(
  params: Record<string, string>,
  scope?: LogScope,
): Record<string, string> {
  const scoped = { ...params };

  if (scope?.workspaceId) {
    scoped.workspace_id = scope.workspaceId;
  }
  if (scope?.workflowId) {
    scoped.workflow_id = scope.workflowId;
  }
  if (scope?.taskId) {
    scoped.task_id = scope.taskId;
  }
  if (scope?.workItemId) {
    scoped.work_item_id = scope.workItemId;
  }
  if (scope?.activationId) {
    scoped.activation_id = scope.activationId;
  }

  return scoped;
}
