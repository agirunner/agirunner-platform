export interface LiveBoardAttentionTaskAction {
  label: string;
  href: string;
  isPrimary: boolean;
}

export function buildAttentionTaskActions(input: {
  taskId: string;
  workflowId?: string | null;
  workItemId?: string | null;
  activationId?: string | null;
  state?: string | null;
  status?: string | null;
}): LiveBoardAttentionTaskAction[] {
  const workflowId = input.workflowId?.trim() ?? '';
  const workItemId = input.workItemId?.trim() ?? '';
  const activationId = input.activationId?.trim() ?? '';
  const taskState = String(input.state ?? input.status ?? 'unknown').toLowerCase();
  const actions: LiveBoardAttentionTaskAction[] = [];

  if (workflowId && workItemId) {
    const params = new URLSearchParams({ work_item: workItemId });
    if (activationId) {
      params.set('activation', activationId);
    }
    actions.push({
      label: 'Open work-item flow',
      href: `/mission-control/workflows/${encodeURIComponent(workflowId)}?${params.toString()}`,
      isPrimary: true,
    });
  } else if (workflowId) {
    actions.push({
      label: 'Open board context',
      href: `/mission-control/workflows/${encodeURIComponent(workflowId)}`,
      isPrimary: true,
    });
  }

  actions.push({
    label:
      workflowId || workItemId
        ? taskState === 'failed'
          ? 'Open failed step diagnostics'
          : 'Open step diagnostics'
        : 'Open step record',
    href: `/mission-control/tasks/${encodeURIComponent(input.taskId)}`,
    isPrimary: false,
  });

  return actions;
}
