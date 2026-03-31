import type {
  WorkflowLiveConsoleItem,
  WorkflowWorkspacePacket,
} from './workflow-operations-types.js';

export function filterLiveConsoleItemsForSelectedScope(
  items: WorkflowLiveConsoleItem[],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
  workflowWorkItemIds: string[],
  workflowTaskToWorkItemIds: ReadonlyMap<string, string> = new Map(),
): WorkflowLiveConsoleItem[] {
  if (selectedScope.scope_kind === 'workflow') {
    return items;
  }

  const workItemIdSet = new Set(workflowWorkItemIds);
  return items.filter((item) =>
    matchesLiveConsoleScope(item, selectedScope, workItemIdSet, workflowTaskToWorkItemIds),
  );
}

function matchesLiveConsoleScope(
  item: WorkflowLiveConsoleItem,
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
  workflowWorkItemIds: ReadonlySet<string>,
  workflowTaskToWorkItemIds: ReadonlyMap<string, string>,
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
      workflowTaskToWorkItemIds,
    );
  }

  const selectedWorkItemId = selectedScope.work_item_id;
  if (!selectedWorkItemId) {
    return false;
  }
  if (
    shouldExcludeForSiblingWorkItem(
      item,
      selectedWorkItemId,
      workflowWorkItemIds,
      workflowTaskToWorkItemIds,
    )
  ) {
    return false;
  }

  return (
    item.work_item_id === selectedWorkItemId
    || item.linked_target_ids.includes(selectedWorkItemId)
    || itemTargetsSelectedWorkItemViaTask(item, selectedWorkItemId, workflowTaskToWorkItemIds)
  );
}

function matchesSelectedTaskScope(
  item: WorkflowLiveConsoleItem,
  selectedScope: WorkflowWorkspacePacket['selected_scope'] & {
    scope_kind: 'selected_task';
    task_id: string | null;
  },
  workflowWorkItemIds: ReadonlySet<string>,
  workflowTaskToWorkItemIds: ReadonlyMap<string, string>,
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
  if (
    selectedWorkItemId
    && shouldExcludeForSiblingWorkItem(
      item,
      selectedWorkItemId,
      workflowWorkItemIds,
      workflowTaskToWorkItemIds,
    )
  ) {
    return false;
  }
  return true;
}

function shouldExcludeForSiblingWorkItem(
  item: WorkflowLiveConsoleItem,
  selectedWorkItemId: string,
  workflowWorkItemIds: ReadonlySet<string>,
  workflowTaskToWorkItemIds: ReadonlyMap<string, string>,
): boolean {
  if (item.work_item_id === selectedWorkItemId) {
    return false;
  }
  if (item.item_kind === 'milestone_brief' && item.linked_target_ids.includes(selectedWorkItemId)) {
    return false;
  }
  if (
    item.item_kind === 'execution_turn'
    && item.scope_binding === 'structured_target'
    && item.work_item_id === selectedWorkItemId
  ) {
    return false;
  }
  if (itemTargetsSelectedWorkItemViaTask(item, selectedWorkItemId, workflowTaskToWorkItemIds)) {
    return false;
  }
  return referencesSiblingWorkItem(
    item,
    selectedWorkItemId,
    workflowWorkItemIds,
    workflowTaskToWorkItemIds,
  );
}

function referencesSiblingWorkItem(
  item: WorkflowLiveConsoleItem,
  selectedWorkItemId: string,
  workflowWorkItemIds: ReadonlySet<string>,
  workflowTaskToWorkItemIds: ReadonlyMap<string, string>,
): boolean {
  const explicitSiblingReference = item.linked_target_ids.some(
    (targetId) => workflowWorkItemIds.has(targetId) && targetId !== selectedWorkItemId,
  );
  if (explicitSiblingReference) {
    return true;
  }
  return readItemTaskTargetIds(item).some((taskId) => {
    const mappedWorkItemId = workflowTaskToWorkItemIds.get(taskId);
    return Boolean(mappedWorkItemId && mappedWorkItemId !== selectedWorkItemId);
  });
}

function itemTargetsSelectedWorkItemViaTask(
  item: WorkflowLiveConsoleItem,
  selectedWorkItemId: string,
  workflowTaskToWorkItemIds: ReadonlyMap<string, string>,
): boolean {
  return readItemTaskTargetIds(item).some(
    (taskId) => workflowTaskToWorkItemIds.get(taskId) === selectedWorkItemId,
  );
}

function readItemTaskTargetIds(item: WorkflowLiveConsoleItem): string[] {
  const taskIds = new Set<string>();
  if (item.task_id) {
    taskIds.add(item.task_id);
  }
  for (const targetId of item.linked_target_ids) {
    if (targetId.startsWith('task-')) {
      taskIds.add(targetId);
    }
  }
  return [...taskIds];
}
