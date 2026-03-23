import type { DashboardEventRecord } from '../../lib/api.js';
import type {
  TimelineDescriptor,
  TimelineLookupContext,
} from './workflow-history-card.narrative.js';
import { describeTimelineEvent } from './workflow-history-card.narrative.js';
import type {
  WorkItemHistoryFilters,
  WorkItemHistorySignalFilter,
  WorkItemHistorySort,
} from './workflow-work-item-history-filters.js';

export {
  filtersToSavedViewState,
  savedViewStateToFilters,
} from './workflow-work-item-history-filters.js';

const TIMELINE_FILTERS_STORAGE_PREFIX = 'agirunner-timeline-filters-';

export const TIMELINE_PAGE_SIZE = 10;

export interface TimelineRecord {
  event: DashboardEventRecord;
  descriptor: TimelineDescriptor;
  searchText: string;
}

export function buildTimelineRecords(
  events: DashboardEventRecord[],
  context: TimelineLookupContext,
): TimelineRecord[] {
  return events.map((event) => {
    const descriptor = describeTimelineEvent(event, context);
    return {
      event,
      descriptor,
      searchText: buildTimelineSearchText(descriptor).toLowerCase(),
    };
  });
}

export function filterAndSortTimelineRecords(
  records: TimelineRecord[],
  filters: WorkItemHistoryFilters,
): TimelineRecord[] {
  const normalizedQuery = filters.query.trim().toLowerCase();
  const visible = records.filter((record) => {
    if (
      filters.signal !== 'all' &&
      !matchesTimelineSignal(record.descriptor.emphasisTone, filters.signal)
    ) {
      return false;
    }
    if (normalizedQuery.length === 0) {
      return true;
    }
    return record.searchText.includes(normalizedQuery);
  });

  return [...visible].sort((left, right) =>
    compareTimelineRecords(left, right, filters.sort),
  );
}

export function paginateTimelineRecords(
  records: TimelineRecord[],
  page: number,
  pageSize = TIMELINE_PAGE_SIZE,
): TimelineRecord[] {
  const safePage = Math.max(0, page);
  const start = safePage * pageSize;
  return records.slice(start, start + pageSize);
}

export function totalTimelinePages(
  recordCount: number,
  pageSize = TIMELINE_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(recordCount / pageSize));
}

export function loadPersistedTimelineFilters(
  storageKey: string,
): WorkItemHistoryFilters {
  const defaults = defaultTimelineFilters();
  if (typeof localStorage === 'undefined') {
    return defaults;
  }
  try {
    const raw = localStorage.getItem(
      `${TIMELINE_FILTERS_STORAGE_PREFIX}${storageKey}`,
    );
    if (!raw) {
      return defaults;
    }
    return normalizeTimelineFilters(JSON.parse(raw));
  } catch {
    return defaults;
  }
}

export function persistTimelineFilters(
  storageKey: string,
  filters: WorkItemHistoryFilters,
): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(
    `${TIMELINE_FILTERS_STORAGE_PREFIX}${storageKey}`,
    JSON.stringify(normalizeTimelineFilters(filters)),
  );
}

function defaultTimelineFilters(): WorkItemHistoryFilters {
  return { query: '', signal: 'all', sort: 'newest' };
}

function normalizeTimelineFilters(value: unknown): WorkItemHistoryFilters {
  const record = asRecord(value);
  return {
    query: typeof record.query === 'string' ? record.query.trim() : '',
    signal: normalizeSignalFilter(record.signal),
    sort: normalizeSort(record.sort),
  };
}

function buildTimelineSearchText(descriptor: TimelineDescriptor): string {
  return [
    descriptor.headline,
    descriptor.narrativeHeadline,
    descriptor.summary,
    descriptor.outcomeLabel,
    descriptor.scopeSummary,
    descriptor.emphasisLabel,
    descriptor.stageName,
    descriptor.workItemId,
    descriptor.taskId,
    descriptor.actorLabel,
    ...descriptor.signalBadges,
  ]
    .filter(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    )
    .join(' ');
}

function matchesTimelineSignal(
  tone: TimelineDescriptor['emphasisTone'],
  signal: WorkItemHistorySignalFilter,
): boolean {
  if (signal === 'all') {
    return true;
  }
  if (signal === 'attention') {
    return tone === 'warning' || tone === 'destructive';
  }
  return tone === signal;
}

function compareTimelineRecords(
  left: TimelineRecord,
  right: TimelineRecord,
  sort: WorkItemHistorySort,
): number {
  if (sort === 'oldest') {
    return left.event.created_at.localeCompare(right.event.created_at);
  }
  if (sort === 'attention') {
    const leftRank = attentionRank(left.descriptor.emphasisTone);
    const rightRank = attentionRank(right.descriptor.emphasisTone);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
  }
  return right.event.created_at.localeCompare(left.event.created_at);
}

function attentionRank(
  tone: TimelineDescriptor['emphasisTone'],
): number {
  switch (tone) {
    case 'destructive':
      return 0;
    case 'warning':
      return 1;
    case 'success':
      return 2;
    default:
      return 3;
  }
}

function normalizeSignalFilter(value: unknown): WorkItemHistorySignalFilter {
  switch (value) {
    case 'attention':
    case 'success':
    case 'secondary':
    case 'warning':
    case 'destructive':
      return value;
    default:
      return 'all';
  }
}

function normalizeSort(value: unknown): WorkItemHistorySort {
  switch (value) {
    case 'oldest':
    case 'attention':
      return value;
    default:
      return 'newest';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
