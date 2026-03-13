export interface TimelineEntryAction {
  label: string;
  href: string;
}

export function buildTimelineEntryActions(input: {
  workflowId: string;
  workItemId: string | null;
  taskId: string | null;
}): TimelineEntryAction[] {
  const actions: TimelineEntryAction[] = [];

  if (input.workItemId) {
    actions.push({
      label: 'Open work item flow',
      href: `/work/workflows/${input.workflowId}?work_item=${encodeURIComponent(input.workItemId)}`,
    });
  }

  if (input.taskId) {
    actions.push({
      label: 'Open step diagnostics',
      href: `/work/tasks/${encodeURIComponent(input.taskId)}`,
    });
  }

  return actions;
}
