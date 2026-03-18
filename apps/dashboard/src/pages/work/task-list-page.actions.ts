import {
  buildWorkflowOperatorPermalink,
  usesWorkItemOperatorFlow,
} from './task-operator-flow.js';

export interface TaskListOperatorScope {
  id: string;
  status: string;
  state?: string;
  created_at?: string;
  workflow_id?: string | null;
  work_item_id?: string | null;
  stage_name?: string | null;
  activation_id?: string | null;
}

export interface TaskPrimaryOperatorAction {
  href: string;
  label: string;
  helper: string;
  showsDiagnosticLink: boolean;
}

export interface TaskDiagnosticAction {
  href: string;
  label: string;
}

export function buildTaskPrimaryOperatorAction(
  task: TaskListOperatorScope,
): TaskPrimaryOperatorAction {
  const workflowPermalink = buildWorkflowOperatorPermalink(task);
  if (workflowPermalink && usesWorkItemOperatorFlow(task)) {
    return {
      href: workflowPermalink,
      label: 'Open work-item flow',
      helper: 'Review this step from the grouped work-item flow so board context stays aligned.',
      showsDiagnosticLink: true,
    };
  }
  if (workflowPermalink && task.workflow_id && task.stage_name) {
    return {
      href: `/work/tasks/${task.id}`,
      label: 'Open step record',
      helper:
        'Use the step record for retry, rework, or rejection. Workflow context is available separately when you need stage history.',
      showsDiagnosticLink: true,
    };
  }
  return {
    href: `/work/tasks/${task.id}`,
    label: 'Open step record',
    helper: 'Open the step record for full context and recent activity.',
    showsDiagnosticLink: false,
  };
}

export function buildTaskDiagnosticAction(
  task: TaskListOperatorScope,
): TaskDiagnosticAction | null {
  const workflowPermalink = buildWorkflowOperatorPermalink(task);
  if (!workflowPermalink) {
    return null;
  }
  if (usesWorkItemOperatorFlow(task)) {
    return {
      href: `/work/tasks/${task.id}`,
      label: isRecoveryStatus(task) ? 'Open failed step diagnostics' : 'Open step diagnostics',
    };
  }
  if (task.workflow_id && task.stage_name) {
    return {
      href: workflowPermalink,
      label: 'Open workflow context',
    };
  }
  if (!usesContextualOperatorFlow(task)) {
    return null;
  }
  return {
    href: `/work/tasks/${task.id}`,
    label: isRecoveryStatus(task) ? 'Open failed step diagnostics' : 'Open step diagnostics',
  };
}

export function readTaskOperatorFlowDescription(
  task: TaskListOperatorScope,
): string | null {
  if (usesWorkItemOperatorFlow(task)) {
    return 'grouped work-item flow';
  }
  return null;
}

function usesContextualOperatorFlow(task: TaskListOperatorScope): boolean {
  return usesWorkItemOperatorFlow(task) || Boolean(task.workflow_id && task.stage_name);
}

function isRecoveryStatus(task: TaskListOperatorScope): boolean {
  const status = (task.state ?? task.status ?? 'unknown').toLowerCase();
  return status === 'failed' || status === 'escalated';
}
