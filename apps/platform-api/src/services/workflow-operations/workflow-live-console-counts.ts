import type { WorkflowLiveConsoleItem, WorkflowLiveConsolePacket } from './workflow-operations-types.js';

export function buildWorkflowLiveConsoleCounts(
  items: WorkflowLiveConsoleItem[],
): WorkflowLiveConsolePacket['counts'] {
  const visibleItems = items.filter((item) => item.item_kind !== 'operator_update');
  const turnUpdates = visibleItems.filter(isWorkflowLiveConsoleTurnUpdate);
  const briefs = visibleItems.filter((item) => item.item_kind === 'milestone_brief');

  return {
    all: visibleItems.length,
    turn_updates: turnUpdates.length,
    briefs: briefs.length,
  };
}

function isWorkflowLiveConsoleTurnUpdate(item: WorkflowLiveConsoleItem): boolean {
  return item.item_kind === 'execution_turn' || item.item_kind === 'platform_notice';
}
