import { buildWorkflowDetailPermalink } from '../../app/routes/workflow-navigation.js';
import {
  buildTaskDetailHref,
  normalizeWorkflowBoardHref,
} from '../work-shared/work-href-support.js';

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
      href: buildWorkflowDetailPermalink(input.workflowId, { workItemId: input.workItemId }),
    });
  }

  if (input.gateStageName) {
    actions.push({
      label: 'Open gate focus',
      href: buildWorkflowDetailPermalink(input.workflowId, {
        gateStageName: input.gateStageName,
      }),
    });
  }

  if (input.activationId) {
    actions.push({
      label: 'Open activation packet',
      href: buildWorkflowDetailPermalink(input.workflowId, {
        activationId: input.activationId,
      }),
    });
  }

  if (input.childWorkflowHref || input.childWorkflowId) {
    const childWorkflowHref = normalizeWorkflowBoardHref({
      href: input.childWorkflowHref,
      workflowId: input.childWorkflowId,
    });
    if (childWorkflowHref) {
      actions.push({
        label: 'Open child board',
        href: childWorkflowHref,
      });
    }
  }

  if (input.taskId) {
    actions.push({
      label: 'Open step diagnostics',
      href: buildTaskDetailHref(input.taskId),
    });
  }

  return actions;
}
