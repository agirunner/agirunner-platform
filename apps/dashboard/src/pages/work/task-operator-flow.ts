import { buildWorkflowDetailPermalink } from '../workflow-detail-permalinks.js';

export interface WorkflowOperatorTaskScope {
  workflow_id?: string | null;
  work_item_id?: string | null;
  stage_name?: string | null;
  activation_id?: string | null;
}

export function usesWorkItemOperatorFlow(task: WorkflowOperatorTaskScope): boolean {
  return Boolean(task.workflow_id && task.work_item_id);
}

export function usesWorkflowOperatorFlow(task: WorkflowOperatorTaskScope): boolean {
  return Boolean(task.workflow_id);
}

export function buildWorkflowOperatorPermalink(
  task: WorkflowOperatorTaskScope,
): string | null {
  if (!task.workflow_id) {
    return null;
  }
  if (task.work_item_id) {
    return buildWorkflowDetailPermalink(task.workflow_id, {
      workItemId: task.work_item_id,
      activationId: task.activation_id ?? null,
    });
  }
  if (task.stage_name) {
    return buildWorkflowDetailPermalink(task.workflow_id, {
      gateStageName: task.stage_name,
    });
  }
  return `/work/boards/${task.workflow_id}`;
}

export function readWorkflowOperatorFlowLabel(
  task: WorkflowOperatorTaskScope,
): string {
  if (usesWorkItemOperatorFlow(task)) {
    return 'Grouped work-item operator flow';
  }
  if (task.workflow_id && task.stage_name) {
    return 'Workflow-linked step context';
  }
  return 'Direct operator decision';
}
