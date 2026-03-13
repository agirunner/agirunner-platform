export interface TimelineEntryAction {
  label: string;
  href: string;
}

export function buildTimelineEntryActions(input: {
  activationId: string | null;
  childWorkflowHref?: string | null;
  childWorkflowId: string | null;
  gateStageName: string | null;
  workflowId: string;
  workItemId: string | null;
  taskId: string | null;
}): TimelineEntryAction[] {
  const actions: TimelineEntryAction[] = [];

  if (input.workItemId) {
    actions.push({
      label: 'Open work item flow',
      href: `/work/boards/${input.workflowId}?work_item=${encodeURIComponent(input.workItemId)}`,
    });
  }

  if (input.gateStageName) {
    actions.push({
      label: 'Open gate focus',
      href: `/work/boards/${input.workflowId}?gate=${encodeURIComponent(input.gateStageName)}#gate-${encodeURIComponent(input.gateStageName)}`,
    });
  }

  if (input.activationId) {
    actions.push({
      label: 'Open activation packet',
      href: `/work/boards/${input.workflowId}?activation=${encodeURIComponent(input.activationId)}#activation-${encodeURIComponent(input.activationId)}`,
    });
  }

  if (input.childWorkflowHref || input.childWorkflowId) {
    actions.push({
      label: 'Open child board',
      href:
        input.childWorkflowHref ??
        `/work/boards/${input.workflowId}?child=${encodeURIComponent(input.childWorkflowId ?? '')}#child-workflow-${encodeURIComponent(input.childWorkflowId ?? '')}`,
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
