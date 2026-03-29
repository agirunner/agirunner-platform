import type {
  DashboardWorkflowNeedsActionItem,
  DashboardWorkflowNeedsActionResponseAction,
} from '../../../lib/api.js';

export interface WorkflowNeedsActionWorkflowTaskContext {
  workItemId: string;
  taskId: string;
}

export function resolveNeedsActionWorkflowTaskContext(input: {
  item: Pick<DashboardWorkflowNeedsActionItem, 'target'>;
  action: Pick<DashboardWorkflowNeedsActionResponseAction, 'kind' | 'target' | 'work_item_id'>;
}): WorkflowNeedsActionWorkflowTaskContext {
  const taskId = input.action.target.target_id.trim();
  const explicitWorkItemId = input.action.work_item_id?.trim();

  if (explicitWorkItemId) {
    return {
      workItemId: explicitWorkItemId,
      taskId,
    };
  }

  if (input.item.target.target_kind === 'work_item') {
    return {
      workItemId: input.item.target.target_id,
      taskId,
    };
  }

  throw new Error('Workflow task action is missing work-item context.');
}
