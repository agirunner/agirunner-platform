export interface WorkItemTaskLinkAction {
  label: string;
  href: string;
  isPrimary: boolean;
}

export function buildWorkItemTaskLinkActions(input: {
  workflowId: string;
  taskId: string;
  workItemId?: string | null;
  state?: string | null;
}): WorkItemTaskLinkAction[] {
  const workflowId = input.workflowId.trim();
  const taskId = input.taskId.trim();
  const workItemId = input.workItemId?.trim() ?? '';
  const state = String(input.state ?? 'unknown').toLowerCase();
  const actions: WorkItemTaskLinkAction[] = [];

  if (workflowId && workItemId) {
    actions.push({
      label: 'Open work-item flow',
      href: `/work/boards/${encodeURIComponent(workflowId)}?work_item=${encodeURIComponent(workItemId)}#work-item-${encodeURIComponent(workItemId)}`,
      isPrimary: true,
    });
  }

  actions.push({
    label:
      workflowId && workItemId
        ? state === 'failed'
          ? 'Open failed step diagnostics'
          : 'Open step diagnostics'
        : 'Open step record',
    href: `/work/tasks/${encodeURIComponent(taskId)}`,
    isPrimary: false,
  });

  return actions;
}
