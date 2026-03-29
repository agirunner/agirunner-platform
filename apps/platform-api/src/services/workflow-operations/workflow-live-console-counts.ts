import type { WorkflowLiveConsoleItem, WorkflowLiveConsolePacket } from './workflow-operations-types.js';

export function buildWorkflowLiveConsoleCounts(
  items: WorkflowLiveConsoleItem[],
): WorkflowLiveConsolePacket['counts'] {
  const visibleItems = items.filter((item) => item.item_kind !== 'operator_update');
  return {
    all: visibleItems.length,
    turn_updates: visibleItems.filter((item) => item.item_kind === 'execution_turn').length,
    briefs: visibleItems.filter((item) => item.item_kind === 'milestone_brief').length,
  };
}
