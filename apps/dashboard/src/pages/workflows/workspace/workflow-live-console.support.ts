import type {
  DashboardWorkflowLiveConsoleItem,
  DashboardWorkflowLiveConsolePacket,
} from '../../../lib/api.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKFLOW_CONSOLE_PREFETCH_THRESHOLD_PX = 96;
const WORKFLOW_CONSOLE_LIVE_EDGE_THRESHOLD_PX = 48;

const WORKFLOW_CONSOLE_ENTRY_STYLES = {
  brief: {
    entryClassName: 'bg-transparent',
  },
  notice: {
    entryClassName: 'bg-transparent',
  },
  update: {
    entryClassName: 'bg-transparent',
  },
} as const;

const WORKFLOW_CONSOLE_ROLE_TONES = {
  orchestrator: {
    promptClassName: 'text-sky-300',
    sourceClassName: 'text-sky-100',
  },
  platform: {
    promptClassName: 'text-amber-300',
    sourceClassName: 'text-amber-100',
  },
  operator: {
    promptClassName: 'text-violet-300',
    sourceClassName: 'text-violet-100',
  },
  specialist: {
    promptClassName: 'text-emerald-300',
    sourceClassName: 'text-emerald-100',
  },
  default: {
    promptClassName: 'text-cyan-300',
    sourceClassName: 'text-slate-100',
  },
} as const;

export type WorkflowConsoleFilter = 'all' | 'turn_updates' | 'briefs';
export type WorkflowConsoleScopeSubject = 'workflow' | 'work item' | 'task';
export type WorkflowConsoleFollowMode = 'live' | 'paused';
export type WorkflowConsoleFilterCounts = Record<WorkflowConsoleFilter, number>;

const WORKFLOW_CONSOLE_FILTER_LABELS: Record<WorkflowConsoleFilter, string> = {
  all: 'All',
  turn_updates: 'Turn updates',
  briefs: 'Briefs',
};

export function formatWorkflowActivitySourceLabel(sourceLabel: string, sourceKind: string): string {
  const normalizedLabel = readNonEmptyText(sourceLabel);
  if (normalizedLabel && !UUID_RE.test(normalizedLabel)) {
    return humanizeToken(normalizedLabel);
  }

  return humanizeToken(sourceKind);
}

export function normalizeWorkflowConsoleText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function getWorkflowConsoleLineText(item: DashboardWorkflowLiveConsoleItem): string {
  const canonicalHeadline = normalizeWorkflowConsoleText(item.headline);
  if (canonicalHeadline.length > 0) {
    return canonicalHeadline;
  }
  return normalizeWorkflowConsoleText(item.summary);
}

export function getWorkflowConsoleEntryPrefix(
  item: DashboardWorkflowLiveConsoleItem,
): '[Brief]' | null {
  if (item.item_kind === 'milestone_brief') {
    return '[Brief]';
  }
  return null;
}

export function getWorkflowConsoleVisibleItems(
  items: DashboardWorkflowLiveConsoleItem[],
): DashboardWorkflowLiveConsoleItem[] {
  return items.filter((item) => item.item_kind !== 'operator_update');
}

export function resolveWorkflowConsoleFilterCounts(
  packet: DashboardWorkflowLiveConsolePacket,
  items: DashboardWorkflowLiveConsoleItem[],
): WorkflowConsoleFilterCounts {
  const visibleItems = getWorkflowConsoleVisibleItems(items);
  const derivedCounts: WorkflowConsoleFilterCounts = {
    all: visibleItems.length,
    turn_updates: visibleItems.filter(isWorkflowConsoleTurnUpdate).length,
    briefs: visibleItems.filter(isWorkflowConsoleBrief).length,
  };
  const packetCounts = readWorkflowConsoleFilterCounts(packet);

  return {
    all: packetCounts.all ?? readWorkflowConsoleTotalCount(packet) ?? derivedCounts.all,
    turn_updates: packetCounts.turn_updates ?? derivedCounts.turn_updates,
    briefs: packetCounts.briefs ?? derivedCounts.briefs,
  };
}

export function buildWorkflowConsoleFilterDescriptors(items: DashboardWorkflowLiveConsoleItem[]): Array<{
  filter: WorkflowConsoleFilter;
  label: string;
  count: number;
}> {
  return buildWorkflowConsoleFilterDescriptorsWithCounts(items, null);
}

export function buildWorkflowConsoleFilterDescriptorsWithCounts(
  items: DashboardWorkflowLiveConsoleItem[],
  counts: Partial<WorkflowConsoleFilterCounts> | null,
): Array<{
  filter: WorkflowConsoleFilter;
  label: string;
  count: number;
}> {
  const resolvedCounts = counts ?? {};
  return (Object.keys(WORKFLOW_CONSOLE_FILTER_LABELS) as WorkflowConsoleFilter[]).map((filter) => ({
    filter,
    label: WORKFLOW_CONSOLE_FILTER_LABELS[filter],
    count: resolvedCounts[filter] ?? filterWorkflowConsoleItems(items, filter).length,
  }));
}

export function filterWorkflowConsoleItems(
  items: DashboardWorkflowLiveConsoleItem[],
  filter: WorkflowConsoleFilter,
): DashboardWorkflowLiveConsoleItem[] {
  const visibleItems = getWorkflowConsoleVisibleItems(items);
  if (filter === 'all') {
    return visibleItems;
  }
  if (filter === 'briefs') {
    return visibleItems.filter(isWorkflowConsoleBrief);
  }
  return visibleItems.filter(isWorkflowConsoleTurnUpdate);
}

export function describeWorkflowConsoleScope(
  scopeSubject: WorkflowConsoleScopeSubject,
  scopeLabel: string,
): string {
  if (scopeSubject === 'task') {
    return `Showing the selected task stream for ${scopeLabel}.`;
  }
  if (scopeSubject === 'work item') {
    return `Showing the selected work item stream for ${scopeLabel}.`;
  }
  return `Showing the workflow stream for ${scopeLabel}.`;
}

export function describeWorkflowConsoleEmptyState(
  filter: WorkflowConsoleFilter,
  scopeLabel: string,
): string {
  if (filter === 'briefs') {
    return `No briefs recorded for ${scopeLabel} yet.`;
  }
  if (filter === 'turn_updates') {
    return `No turn updates recorded for ${scopeLabel} yet.`;
  }
  return `No live console entries recorded for ${scopeLabel} yet.`;
}

export function describeWorkflowConsoleCoverage(
  items: DashboardWorkflowLiveConsoleItem[],
  nextCursor: string | null,
  totalCount?: number | null,
): string | null {
  if (!nextCursor || items.length === 0) {
    return null;
  }
  const lineLabel = items.length === 1 ? 'line' : 'lines';
  const hasExpandedTotal = typeof totalCount === 'number' && totalCount > items.length;
  const totalSegment = hasExpandedTotal ? ` out of ${totalCount} total` : '';
  return `Showing the latest ${items.length} loaded ${lineLabel}${totalSegment}. Older lines stream in automatically as you scroll upward.`;
}

export function orderWorkflowConsoleItemsForDisplay(
  items: DashboardWorkflowLiveConsoleItem[],
): DashboardWorkflowLiveConsoleItem[] {
  return [...items].reverse();
}

export function shouldPrefetchWorkflowConsoleHistory(input: {
  hasNextCursor: boolean;
  isLoadingOlderHistory: boolean;
  scrollTop: number;
}): boolean {
  if (!input.hasNextCursor || input.isLoadingOlderHistory) {
    return false;
  }
  return input.scrollTop <= WORKFLOW_CONSOLE_PREFETCH_THRESHOLD_PX;
}

export function isWorkflowConsoleAtLiveEdge(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  return (
    input.scrollHeight - input.clientHeight - input.scrollTop <=
    WORKFLOW_CONSOLE_LIVE_EDGE_THRESHOLD_PX
  );
}

export function getWorkflowConsoleScrollBehavior(input: {
  followMode: WorkflowConsoleFollowMode;
  hasNextCursor: boolean;
  isLoadingOlderHistory: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): {
  isAtLiveEdge: boolean;
  shouldClearQueuedUpdates: boolean;
  shouldPrefetchHistory: boolean;
  shouldStickToLiveEdge: boolean;
} {
  const isAtLiveEdge = isWorkflowConsoleAtLiveEdge(input);
  const shouldStickToLiveEdge = input.followMode === 'live' && !isAtLiveEdge;

  return {
    isAtLiveEdge,
    shouldClearQueuedUpdates: isAtLiveEdge,
    shouldPrefetchHistory:
      !shouldStickToLiveEdge &&
      shouldPrefetchWorkflowConsoleHistory({
        hasNextCursor: input.hasNextCursor,
        isLoadingOlderHistory: input.isLoadingOlderHistory,
        scrollTop: input.scrollTop,
      }),
    shouldStickToLiveEdge,
  };
}

export function getWorkflowConsoleFollowBehavior(input: {
  followMode: WorkflowConsoleFollowMode;
  isAtLiveEdge: boolean;
  prependedHistory: boolean;
  appendedLiveUpdate: boolean;
  hasPreviousItems: boolean;
}): {
  shouldScrollToBottom: boolean;
  shouldQueueUpdates: boolean;
} {
  if (input.prependedHistory || !input.appendedLiveUpdate) {
    return {
      shouldScrollToBottom: !input.hasPreviousItems,
      shouldQueueUpdates: false,
    };
  }

  if (!input.hasPreviousItems || input.followMode === 'live') {
    return {
      shouldScrollToBottom: true,
      shouldQueueUpdates: false,
    };
  }

  return {
    shouldScrollToBottom: false,
    shouldQueueUpdates: true,
  };
}

export function resolveWorkflowConsoleWindowChange(input: {
  previousItemIds: string[];
  currentItemIds: string[];
}): {
  prependedHistory: boolean;
  appendedLiveUpdate: boolean;
} {
  if (input.previousItemIds.length === 0 || input.currentItemIds.length === 0) {
    return {
      prependedHistory: false,
      appendedLiveUpdate: false,
    };
  }

  const previousFirstItemId = input.previousItemIds[0] ?? '';
  const previousLastItemId = input.previousItemIds[input.previousItemIds.length - 1] ?? '';
  const currentFirstItemId = input.currentItemIds[0] ?? '';
  const currentLastItemId = input.currentItemIds[input.currentItemIds.length - 1] ?? '';

  return {
    prependedHistory:
      previousLastItemId === currentLastItemId &&
      previousFirstItemId !== currentFirstItemId &&
      readWindowOverlapLength(input.currentItemIds, input.previousItemIds) > 0,
    appendedLiveUpdate:
      previousLastItemId !== currentLastItemId &&
      readWindowOverlapLength(input.previousItemIds, input.currentItemIds) > 0,
  };
}

export function getWorkflowConsoleEntryStyle(itemKind: string, sourceKind: string): {
  dataKind: 'brief' | 'notice' | 'update';
  entryClassName: string;
  promptClassName: string;
  sourceClassName: string;
} {
  const roleTone = WORKFLOW_CONSOLE_ROLE_TONES[sourceKind as keyof typeof WORKFLOW_CONSOLE_ROLE_TONES]
    ?? WORKFLOW_CONSOLE_ROLE_TONES.default;

  if (itemKind === 'milestone_brief') {
    return {
      dataKind: 'brief',
      ...WORKFLOW_CONSOLE_ENTRY_STYLES.brief,
      ...roleTone,
    };
  }

  if (itemKind === 'platform_notice') {
    return {
      dataKind: 'notice',
      ...WORKFLOW_CONSOLE_ENTRY_STYLES.notice,
      ...WORKFLOW_CONSOLE_ROLE_TONES.platform,
    };
  }

  return {
    dataKind: 'update',
    ...WORKFLOW_CONSOLE_ENTRY_STYLES.update,
    ...roleTone,
  };
}

function isWorkflowConsoleBrief(item: DashboardWorkflowLiveConsoleItem): boolean {
  return item.item_kind === 'milestone_brief';
}

function isWorkflowConsoleTurnUpdate(item: DashboardWorkflowLiveConsoleItem): boolean {
  return item.item_kind === 'execution_turn';
}

function readNonEmptyText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readWorkflowConsoleFilterCounts(
  packet: DashboardWorkflowLiveConsolePacket,
): Partial<WorkflowConsoleFilterCounts> {
  const rawPacket = packet as unknown as Record<string, unknown>;
  const rawCounts =
    readRecord(packet.counts) ??
    readRecord(rawPacket.filter_counts) ??
    readRecord(rawPacket.filterCounts);

  if (!rawCounts) {
    return {};
  }

  const counts: Partial<WorkflowConsoleFilterCounts> = {};
  const allCount = normalizeConsoleCount(rawCounts.all);
  const turnUpdatesCount =
    normalizeConsoleCount(rawCounts.turn_updates) ?? normalizeConsoleCount(rawCounts.turnUpdates);
  const briefsCount = normalizeConsoleCount(rawCounts.briefs);

  if (allCount !== null) {
    counts.all = allCount;
  }
  if (turnUpdatesCount !== null) {
    counts.turn_updates = turnUpdatesCount;
  }
  if (briefsCount !== null) {
    counts.briefs = briefsCount;
  }

  return counts;
}

function readWorkflowConsoleTotalCount(packet: DashboardWorkflowLiveConsolePacket): number | null {
  const rawPacket = packet as unknown as Record<string, unknown>;
  return normalizeConsoleCount(packet.total_count) ?? normalizeConsoleCount(rawPacket.totalCount);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readWindowOverlapLength(left: string[], right: string[]): number {
  const overlapLimit = Math.min(left.length, right.length);
  for (let overlapLength = overlapLimit; overlapLength > 0; overlapLength -= 1) {
    let matches = true;
    for (let index = 0; index < overlapLength; index += 1) {
      if (left[left.length - overlapLength + index] !== right[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return overlapLength;
    }
  }
  return 0;
}

function normalizeConsoleCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
