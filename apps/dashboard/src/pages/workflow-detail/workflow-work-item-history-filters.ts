import type { DashboardEventRecord } from '../lib/api.js';
import {
  buildWorkItemHistoryPacket,
  type WorkItemHistoryPacket,
} from './workflow-work-item-history-support.js';

const HISTORY_FILTERS_STORAGE_PREFIX = 'agirunner-work-item-history-filters-';

export type WorkItemHistorySignalFilter =
  | 'all'
  | 'attention'
  | 'success'
  | 'secondary'
  | 'warning'
  | 'destructive';

export type WorkItemHistorySort = 'newest' | 'oldest' | 'attention';

export interface WorkItemHistoryFilters {
  query: string;
  signal: WorkItemHistorySignalFilter;
  sort: WorkItemHistorySort;
}

export interface WorkItemHistoryRecord {
  event: DashboardEventRecord;
  packet: WorkItemHistoryPacket;
  searchText: string;
}

export const WORK_ITEM_HISTORY_PAGE_SIZE = 10;

export function buildWorkItemHistoryRecords(
  events: DashboardEventRecord[],
): WorkItemHistoryRecord[] {
  return events.map((event) => {
    const packet = buildWorkItemHistoryPacket(event);
    return {
      event,
      packet,
      searchText: buildWorkItemHistorySearchText(packet).toLowerCase(),
    };
  });
}

export function filterAndSortWorkItemHistoryRecords(
  records: WorkItemHistoryRecord[],
  filters: WorkItemHistoryFilters,
): WorkItemHistoryRecord[] {
  const normalizedQuery = filters.query.trim().toLowerCase();
  const visible = records.filter((record) => {
    if (filters.signal !== 'all' && !matchesSignalFilter(record.packet, filters.signal)) {
      return false;
    }
    if (normalizedQuery.length === 0) {
      return true;
    }
    return record.searchText.includes(normalizedQuery);
  });

  return [...visible].sort((left, right) => compareHistoryRecords(left, right, filters.sort));
}

export function paginateWorkItemHistoryRecords(
  records: WorkItemHistoryRecord[],
  page: number,
  pageSize = WORK_ITEM_HISTORY_PAGE_SIZE,
): WorkItemHistoryRecord[] {
  const safePage = Math.max(0, page);
  const start = safePage * pageSize;
  return records.slice(start, start + pageSize);
}

export function totalHistoryPages(
  recordCount: number,
  pageSize = WORK_ITEM_HISTORY_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(recordCount / pageSize));
}

export function loadPersistedWorkItemHistoryFilters(
  storageKey: string,
): WorkItemHistoryFilters {
  const defaults = defaultWorkItemHistoryFilters();
  if (typeof localStorage === 'undefined') {
    return defaults;
  }
  try {
    const raw = localStorage.getItem(`${HISTORY_FILTERS_STORAGE_PREFIX}${storageKey}`);
    if (!raw) {
      return defaults;
    }
    return normalizeWorkItemHistoryFilters(JSON.parse(raw));
  } catch {
    return defaults;
  }
}

export function persistWorkItemHistoryFilters(
  storageKey: string,
  filters: WorkItemHistoryFilters,
): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(
    `${HISTORY_FILTERS_STORAGE_PREFIX}${storageKey}`,
    JSON.stringify(normalizeWorkItemHistoryFilters(filters)),
  );
}

export function filtersToSavedViewState(
  filters: WorkItemHistoryFilters,
): Record<string, string> {
  return {
    ...(filters.query ? { q: filters.query } : {}),
    ...(filters.signal !== 'all' ? { signal: filters.signal } : {}),
    ...(filters.sort !== 'newest' ? { sort: filters.sort } : {}),
  };
}

export function savedViewStateToFilters(
  filters: Record<string, string>,
): WorkItemHistoryFilters {
  return normalizeWorkItemHistoryFilters({
    query: filters.q ?? '',
    signal: filters.signal,
    sort: filters.sort,
  });
}

function defaultWorkItemHistoryFilters(): WorkItemHistoryFilters {
  return {
    query: '',
    signal: 'all',
    sort: 'newest',
  };
}

function normalizeWorkItemHistoryFilters(value: unknown): WorkItemHistoryFilters {
  const record = asRecord(value);
  return {
    query: coerceDisplayText(record.query, '') ?? '',
    signal: normalizeSignalFilter(record.signal),
    sort: normalizeSort(record.sort),
  };
}

function buildWorkItemHistorySearchText(packet: WorkItemHistoryPacket): string {
  return [
    packet.headline,
    packet.summary,
    packet.scopeSummary,
    packet.emphasisLabel,
    packet.stageName,
    packet.workItemId,
    packet.taskId,
    packet.actor,
    ...packet.signalBadges,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

function matchesSignalFilter(
  packet: WorkItemHistoryPacket,
  signal: WorkItemHistorySignalFilter,
): boolean {
  if (signal === 'all') {
    return true;
  }
  if (signal === 'attention') {
    return packet.emphasisTone === 'warning' || packet.emphasisTone === 'destructive';
  }
  return packet.emphasisTone === signal;
}

function compareHistoryRecords(
  left: WorkItemHistoryRecord,
  right: WorkItemHistoryRecord,
  sort: WorkItemHistorySort,
): number {
  if (sort === 'oldest') {
    return left.event.created_at.localeCompare(right.event.created_at);
  }
  if (sort === 'attention') {
    const leftRank = attentionRank(left.packet.emphasisTone);
    const rightRank = attentionRank(right.packet.emphasisTone);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
  }
  return right.event.created_at.localeCompare(left.event.created_at);
}

function attentionRank(tone: WorkItemHistoryPacket['emphasisTone']): number {
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

function coerceDisplayText(value: unknown, fallback: string): string | null {
  return coerceOptionalDisplayText(value) ?? fallback;
}

function coerceOptionalDisplayText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const values = value
      .map((entry) => coerceOptionalDisplayText(entry))
      .filter((entry): entry is string => Boolean(entry));
    return values.length > 0 ? values.join(', ') : null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      coerceOptionalDisplayText(record.label) ??
      coerceOptionalDisplayText(record.title) ??
      coerceOptionalDisplayText(record.name) ??
      coerceOptionalDisplayText(record.summary) ??
      coerceOptionalDisplayText(record.message) ??
      coerceOptionalDisplayText(record.id) ??
      coerceOptionalDisplayText(record.count) ??
      null
    );
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
