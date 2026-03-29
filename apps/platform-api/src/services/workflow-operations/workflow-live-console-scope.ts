import type {
  WorkflowLiveConsoleItem,
  WorkflowWorkspacePacket,
} from './workflow-operations-types.js';

export function filterLiveConsoleItemsForSelectedScope(
  items: WorkflowLiveConsoleItem[],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
  workflowWorkItemIds: string[],
): WorkflowLiveConsoleItem[] {
  if (selectedScope.scope_kind === 'workflow') {
    return items;
  }

  const workItemIdSet = new Set(workflowWorkItemIds);
  return items.filter((item) => matchesLiveConsoleScope(item, selectedScope, workItemIdSet));
}

function matchesLiveConsoleScope(
  item: WorkflowLiveConsoleItem,
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
  workflowWorkItemIds: ReadonlySet<string>,
): boolean {
  if (selectedScope.scope_kind === 'selected_task') {
    return matchesSelectedTaskScope(
      item,
      {
        scope_kind: 'selected_task',
        work_item_id: selectedScope.work_item_id,
        task_id: selectedScope.task_id,
      },
      workflowWorkItemIds,
    );
  }

  const selectedWorkItemId = selectedScope.work_item_id;
  if (!selectedWorkItemId) {
    return false;
  }
  if (shouldExcludeForSiblingWorkItem(item, selectedWorkItemId, workflowWorkItemIds)) {
    return false;
  }

  return item.work_item_id === selectedWorkItemId || item.linked_target_ids.includes(selectedWorkItemId);
}

function matchesSelectedTaskScope(
  item: WorkflowLiveConsoleItem,
  selectedScope: WorkflowWorkspacePacket['selected_scope'] & {
    scope_kind: 'selected_task';
    task_id: string | null;
  },
  workflowWorkItemIds: ReadonlySet<string>,
): boolean {
  const taskId = selectedScope.task_id;
  if (!taskId) {
    return false;
  }
  if (item.task_id && item.task_id !== taskId) {
    return false;
  }
  if (item.task_id !== taskId && !item.linked_target_ids.includes(taskId)) {
    return false;
  }
  const selectedWorkItemId = selectedScope.work_item_id;
  if (selectedWorkItemId && shouldExcludeForSiblingWorkItem(item, selectedWorkItemId, workflowWorkItemIds)) {
    return false;
  }
  return true;
}

function shouldExcludeForSiblingWorkItem(
  item: WorkflowLiveConsoleItem,
  selectedWorkItemId: string,
  workflowWorkItemIds: ReadonlySet<string>,
): boolean {
  if (item.item_kind === 'milestone_brief' && item.linked_target_ids.includes(selectedWorkItemId)) {
    return false;
  }
  return referencesSiblingWorkItem(item, selectedWorkItemId, workflowWorkItemIds);
}

function referencesSiblingWorkItem(
  item: WorkflowLiveConsoleItem,
  selectedWorkItemId: string,
  workflowWorkItemIds: ReadonlySet<string>,
): boolean {
  return item.linked_target_ids.some(
    (targetId) => workflowWorkItemIds.has(targetId) && targetId !== selectedWorkItemId,
  );
}
