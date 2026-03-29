import type { DashboardWorkflowLiveConsoleItem } from '../../../lib/api.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const WORKFLOW_CONSOLE_ENTRY_STYLES = {
  brief: {
    entryClassName: 'border-l-emerald-400/70 bg-emerald-500/5',
    promptClassName: 'text-emerald-300',
    sourceClassName: 'text-emerald-100',
  },
  notice: {
    entryClassName: 'border-l-amber-400/70 bg-amber-500/5',
    promptClassName: 'text-amber-300',
    sourceClassName: 'text-amber-100',
  },
  update: {
    entryClassName: 'border-l-slate-700 bg-slate-950/70',
    promptClassName: 'text-cyan-300',
    sourceClassName: 'text-slate-100',
  },
} as const;

export type WorkflowConsoleFilter = 'all' | 'turn_updates' | 'briefs';
export type WorkflowConsoleScopeSubject = 'workflow' | 'work item' | 'task';

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

export function buildWorkflowConsoleFilterDescriptors(items: DashboardWorkflowLiveConsoleItem[]): Array<{
  filter: WorkflowConsoleFilter;
  label: string;
  count: number;
}> {
  return (Object.keys(WORKFLOW_CONSOLE_FILTER_LABELS) as WorkflowConsoleFilter[]).map((filter) => ({
    filter,
    label: WORKFLOW_CONSOLE_FILTER_LABELS[filter],
    count: filterWorkflowConsoleItems(items, filter).length,
  }));
}

export function filterWorkflowConsoleItems(
  items: DashboardWorkflowLiveConsoleItem[],
  filter: WorkflowConsoleFilter,
): DashboardWorkflowLiveConsoleItem[] {
  if (filter === 'all') {
    return items;
  }
  if (filter === 'briefs') {
    return items.filter(isWorkflowConsoleBrief);
  }
  return items.filter(isWorkflowConsoleTurnUpdate);
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
  const headlineLabel = items.length === 1 ? 'headline' : 'headlines';
  const hasExpandedTotal = typeof totalCount === 'number' && totalCount > items.length;
  const totalSegment = hasExpandedTotal ? ` out of ${totalCount} total` : '';
  return `Showing the latest ${items.length} loaded ${headlineLabel}${totalSegment}. Filter counts reflect the current window until you load older headlines.`;
}

export function getWorkflowConsoleEntryStyle(itemKind: string): {
  dataKind: 'brief' | 'notice' | 'update';
  entryClassName: string;
  promptClassName: string;
  sourceClassName: string;
} {
  if (itemKind === 'milestone_brief') {
    return {
      dataKind: 'brief',
      ...WORKFLOW_CONSOLE_ENTRY_STYLES.brief,
    };
  }

  if (itemKind === 'platform_notice') {
    return {
      dataKind: 'notice',
      ...WORKFLOW_CONSOLE_ENTRY_STYLES.notice,
    };
  }

  return {
    dataKind: 'update',
    ...WORKFLOW_CONSOLE_ENTRY_STYLES.update,
  };
}

function isWorkflowConsoleBrief(item: DashboardWorkflowLiveConsoleItem): boolean {
  return item.item_kind === 'milestone_brief';
}

function isWorkflowConsoleTurnUpdate(item: DashboardWorkflowLiveConsoleItem): boolean {
  return item.item_kind === 'operator_update' || item.item_kind === 'execution_turn';
}

function readNonEmptyText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
