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
  const selectedWorkItemId = selectedScope.work_item_id;
  if (!selectedWorkItemId) {
    return false;
  }
  if (referencesSiblingWorkItem(item, selectedWorkItemId, workflowWorkItemIds)) {
    return false;
  }
  if (isAmbiguousScopedOrchestratorTurn(item)) {
    return false;
  }

  if (selectedScope.scope_kind === 'selected_task') {
    return matchesSelectedTaskScope(item, selectedScope.task_id);
  }

  return item.work_item_id === selectedWorkItemId || item.linked_target_ids.includes(selectedWorkItemId);
}

function matchesSelectedTaskScope(
  item: WorkflowLiveConsoleItem,
  taskId: string | null,
): boolean {
  if (!taskId) {
    return false;
  }
  return item.task_id === taskId || item.linked_target_ids.includes(taskId);
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

function isAmbiguousScopedOrchestratorTurn(item: WorkflowLiveConsoleItem): boolean {
  return (
    item.item_kind === 'execution_turn'
    && item.source_kind === 'orchestrator'
    && item.scope_binding === 'execution_context'
  );
}
