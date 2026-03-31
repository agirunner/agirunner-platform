import type { MissionControlWorkflowCard } from '../mission-control-types.js';
import type {
  WorkflowBottomTabsPacket,
  WorkflowBriefItem,
  WorkflowHistoryItem,
  WorkflowLiveConsoleItem,
  WorkflowWorkspacePacket,
} from '../workflow-operations-types.js';
import { buildWorkflowLiveConsoleCounts } from '../workflow-live-console-counts.js';
import { filterLiveConsoleItemsForSelectedScope } from '../workflow-live-console-scope.js';
import type {
  WorkflowTaskBindingRecord,
  WorkflowWorkspaceQuery,
} from './workflow-workspace-types.js';
import { asRecord, readOptionalString } from './workflow-workspace-common.js';

export function resolveSelectedScope(input: WorkflowWorkspaceQuery): WorkflowWorkspacePacket['selected_scope'] {
  if (input.tabScope === 'selected_task' && input.taskId) {
    return {
      scope_kind: 'selected_task',
      work_item_id: input.workItemId ?? null,
      task_id: input.taskId,
    };
  }
  if (input.tabScope === 'selected_work_item' && input.workItemId) {
    return {
      scope_kind: 'selected_work_item',
      work_item_id: input.workItemId,
      task_id: null,
    };
  }
  return {
    scope_kind: 'workflow',
    work_item_id: null,
    task_id: null,
  };
}

export function buildStickyStrip(
  workflowCard: MissionControlWorkflowCard,
  steeringAvailable: boolean,
) {
  return {
    workflow_id: workflowCard.id,
    workflow_name: workflowCard.name,
    posture: workflowCard.posture,
    summary: workflowCard.pulse.summary,
    approvals_count: workflowCard.metrics.waitingForDecisionCount,
    escalations_count: workflowCard.metrics.openEscalationCount,
    blocked_work_item_count: workflowCard.metrics.blockedWorkItemCount,
    active_task_count: workflowCard.metrics.activeTaskCount,
    active_work_item_count: workflowCard.metrics.activeWorkItemCount,
    steering_available: steeringAvailable,
  };
}

export function buildBottomTabs(
  needsActionCount: number,
  steeringCount: number,
  liveConsoleCount: number,
  briefsCount: number,
  historyCount: number,
  deliverablesCount: number,
  input: WorkflowWorkspaceQuery,
): WorkflowBottomTabsPacket {
  return {
    default_tab: 'details',
    current_scope_kind:
      input.tabScope === 'selected_task' && input.taskId
        ? 'selected_task'
        : input.tabScope === 'selected_work_item' && input.workItemId
          ? 'selected_work_item'
          : 'workflow',
    current_work_item_id:
      input.tabScope === 'selected_work_item' || input.tabScope === 'selected_task'
        ? input.workItemId ?? null
        : null,
    current_task_id: input.tabScope === 'selected_task' ? input.taskId ?? null : null,
    counts: {
      details: 1,
      needs_action: needsActionCount,
      steering: steeringCount,
      live_console_activity: liveConsoleCount,
      briefs: briefsCount,
      history: historyCount,
      deliverables: deliverablesCount,
    },
  };
}

export function filterLiveConsoleForSelectedScope(
  packet: WorkflowWorkspacePacket['live_console'],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
  workflowWorkItemIds: string[],
  workflowTaskToWorkItemIds: ReadonlyMap<string, string>,
): WorkflowWorkspacePacket['live_console'] {
  if (selectedScope.scope_kind === 'workflow') {
    return packet;
  }
  if (packet.scope_filtered) {
    return packet;
  }
  const filteredItems = filterLiveConsoleItemsForSelectedScope(
    packet.items,
    selectedScope,
    workflowWorkItemIds,
    workflowTaskToWorkItemIds,
  );
  const counts = buildWorkflowLiveConsoleCounts(filteredItems);
  if (
    filteredItems.length === packet.items.length
    && packet.total_count === counts.all
    && areLiveConsoleCountsEqual(packet.counts, counts)
  ) {
    return packet;
  }
  return {
    ...packet,
    items: filteredItems,
    total_count: counts.all,
    counts,
  };
}

export function normalizeLiveConsolePacketForVisibleRows(
  packet: WorkflowWorkspacePacket['live_console'],
): WorkflowWorkspacePacket['live_console'] {
  const visibleItems = packet.items.filter((item) => item.item_kind !== 'operator_update');
  if (visibleItems.length === packet.items.length) {
    return packet;
  }
  const counts = buildWorkflowLiveConsoleCounts(visibleItems);
  return {
    ...packet,
    items: visibleItems,
    total_count: counts.all,
    counts,
  };
}

export function buildBoardTaskToWorkItemMap(board: Record<string, unknown>): Map<string, string> {
  const taskToWorkItemIds = new Map<string, string>();
  const workItems = Array.isArray(board.work_items) ? board.work_items : [];
  for (const rawWorkItem of workItems) {
    const workItem = asRecord(rawWorkItem);
    const workItemId = readOptionalString(workItem.id);
    if (!workItemId) {
      continue;
    }
    const tasks = Array.isArray(workItem.tasks) ? workItem.tasks : [];
    for (const rawTask of tasks) {
      const taskId = readOptionalString(asRecord(rawTask).id);
      if (taskId) {
        taskToWorkItemIds.set(taskId, workItemId);
      }
    }
  }
  return taskToWorkItemIds;
}

export function buildTaskToWorkItemMap(tasks: WorkflowTaskBindingRecord[]): Map<string, string> {
  const taskToWorkItemIds = new Map<string, string>();
  for (const task of tasks) {
    if (task.work_item_id) {
      taskToWorkItemIds.set(task.id, task.work_item_id);
    }
  }
  return taskToWorkItemIds;
}

export function mergeTaskToWorkItemMaps(
  primary: ReadonlyMap<string, string>,
  fallback: ReadonlyMap<string, string>,
): Map<string, string> {
  const merged = new Map(fallback);
  for (const [taskId, workItemId] of primary.entries()) {
    merged.set(taskId, workItemId);
  }
  return merged;
}

export function readBoardWorkItemIds(board: Record<string, unknown>): string[] {
  const workItems = board.work_items;
  if (!Array.isArray(workItems)) {
    return [];
  }
  return workItems
    .map((item) => readOptionalString(asRecord(item).id))
    .filter((workItemId): workItemId is string => workItemId !== null);
}

export function filterHistoryForSelectedScope(
  packet: WorkflowWorkspacePacket['history'],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): WorkflowWorkspacePacket['history'] {
  const filteredItems = packet.items.filter((item) => matchesScopedRecord(item, selectedScope));
  if (filteredItems.length === packet.items.length) {
    return packet;
  }
  return {
    ...packet,
    items: filteredItems,
    total_count: filteredItems.length,
    groups: buildHistoryGroupsFromItems(filteredItems),
  };
}

export function filterBriefsForSelectedScope(
  packet: WorkflowWorkspacePacket['briefs'],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
  workflowTaskToWorkItemIds: ReadonlyMap<string, string>,
): WorkflowWorkspacePacket['briefs'] {
  const filteredItems = packet.items.filter((item) =>
    matchesScopedBriefRecord(item, selectedScope, workflowTaskToWorkItemIds),
  );
  if (filteredItems.length === packet.items.length) {
    return packet;
  }
  return {
    ...packet,
    items: filteredItems,
    total_count: filteredItems.length,
  };
}

export function readPacketTotalCount(
  packet: Pick<
    WorkflowWorkspacePacket['live_console'] | WorkflowWorkspacePacket['briefs'] | WorkflowWorkspacePacket['history'],
    'items'
  > & {
    total_count?: number;
  },
): number {
  return typeof packet.total_count === 'number' ? packet.total_count : packet.items.length;
}

export function buildEmptyBriefsPacket(
  snapshot: Pick<WorkflowWorkspacePacket['history'], 'generated_at' | 'latest_event_id' | 'snapshot_version'>,
): WorkflowWorkspacePacket['briefs'] {
  return {
    generated_at: snapshot.generated_at,
    latest_event_id: snapshot.latest_event_id,
    snapshot_version: snapshot.snapshot_version,
    items: [],
    total_count: 0,
    next_cursor: null,
  };
}

function matchesScopedRecord(
  item: Pick<
    WorkflowLiveConsoleItem | WorkflowHistoryItem | WorkflowBriefItem,
    'work_item_id' | 'task_id' | 'linked_target_ids'
  >,
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): boolean {
  if (selectedScope.scope_kind === 'workflow') {
    return true;
  }

  if (selectedScope.scope_kind === 'selected_task') {
    return matchesTaskScope(item, selectedScope.task_id);
  }

  return matchesWorkItemScope(item, selectedScope.work_item_id);
}

function matchesScopedBriefRecord(
  item: Pick<WorkflowBriefItem, 'work_item_id' | 'task_id' | 'linked_target_ids'>,
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
  workflowTaskToWorkItemIds: ReadonlyMap<string, string>,
): boolean {
  if (selectedScope.scope_kind === 'workflow') {
    return true;
  }
  if (selectedScope.scope_kind === 'selected_task') {
    return matchesTaskScope(item, selectedScope.task_id);
  }
  return matchesWorkItemScopeViaTask(item, selectedScope.work_item_id, workflowTaskToWorkItemIds);
}

function matchesTaskScope(
  item: Pick<WorkflowLiveConsoleItem | WorkflowHistoryItem, 'task_id' | 'linked_target_ids'>,
  taskId: string | null,
): boolean {
  if (!taskId) {
    return false;
  }

  return item.task_id === taskId || item.linked_target_ids.includes(taskId);
}

function matchesWorkItemScope(
  item: Pick<WorkflowLiveConsoleItem | WorkflowHistoryItem, 'work_item_id' | 'linked_target_ids'>,
  workItemId: string | null,
): boolean {
  if (!workItemId) {
    return false;
  }

  return item.work_item_id === workItemId || item.linked_target_ids.includes(workItemId);
}

function matchesWorkItemScopeViaTask(
  item: Pick<WorkflowBriefItem, 'work_item_id' | 'task_id' | 'linked_target_ids'>,
  workItemId: string | null,
  workflowTaskToWorkItemIds: ReadonlyMap<string, string>,
): boolean {
  if (matchesWorkItemScope(item, workItemId)) {
    return true;
  }
  if (!workItemId) {
    return false;
  }
  const targetTaskIds = new Set<string>();
  if (item.task_id) {
    targetTaskIds.add(item.task_id);
  }
  for (const targetId of item.linked_target_ids) {
    if (workflowTaskToWorkItemIds.has(targetId)) {
      targetTaskIds.add(targetId);
    }
  }
  for (const taskId of targetTaskIds) {
    if (workflowTaskToWorkItemIds.get(taskId) === workItemId) {
      return true;
    }
  }
  return false;
}

function buildHistoryGroupsFromItems(items: WorkflowHistoryItem[]): WorkflowWorkspacePacket['history']['groups'] {
  const idsByDay = new Map<string, string[]>();
  for (const item of items) {
    const groupId = item.created_at.slice(0, 10);
    const itemIds = idsByDay.get(groupId) ?? [];
    itemIds.push(item.item_id);
    idsByDay.set(groupId, itemIds);
  }

  return Array.from(idsByDay.entries()).map(([groupId, itemIds]) => ({
    group_id: groupId,
    label: groupId,
    anchor_at: `${groupId}T00:00:00.000Z`,
    item_ids: itemIds,
  }));
}

function areLiveConsoleCountsEqual(
  left: WorkflowWorkspacePacket['live_console']['counts'] | undefined,
  right: WorkflowWorkspacePacket['live_console']['counts'],
): boolean {
  if (!left) {
    return false;
  }
  return (
    left.all === right.all
    && left.turn_updates === right.turn_updates
    && left.briefs === right.briefs
    && (left.steering ?? 0) === (right.steering ?? 0)
  );
}
