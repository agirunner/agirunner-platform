import { buildWorkflowDetailPermalink } from '../../app/routes/workflow-navigation.js';
import { buildTaskDetailHref } from '../work-shared/work-href-support.js';

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
      href: buildWorkflowDetailPermalink(workflowId, { workItemId }),
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
    href: buildTaskDetailHref(taskId),
    isPrimary: false,
  });

  return actions;
}
