import type { MemoryEntry } from './workspace-memory-support.js';

export interface MemoryActorOption {
  value: string;
  label: string;
  count: number;
}

export interface MemoryKeyOption {
  value: string;
  count: number;
  latestUpdatedAt: string | null;
}

export interface MemoryHistoryReview {
  versions: MemoryEntry[];
  selectedEntry: MemoryEntry | null;
  previousEntry: MemoryEntry | null;
  selectedText: string;
  previousText: string;
}

export function buildMemoryActorOptions(entries: MemoryEntry[]): MemoryActorOption[] {
  const counts = new Map<string, MemoryActorOption>();

  for (const entry of entries) {
    const value = buildActorFilterValue(entry);
    if (!value) {
      continue;
    }
    const existing = counts.get(value);
    if (existing) {
      existing.count += 1;
      continue;
    }
    counts.set(value, {
      value,
      label: formatMemoryActor(entry.actorType, entry.actorId),
      count: 1,
    });
  }

  return [...counts.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function buildMemoryKeyOptions(entries: MemoryEntry[]): MemoryKeyOption[] {
  const byKey = new Map<string, MemoryKeyOption>();

  for (const entry of entries) {
    const existing = byKey.get(entry.key);
    if (existing) {
      existing.count += 1;
      if ((entry.updatedAt ?? '') > (existing.latestUpdatedAt ?? '')) {
        existing.latestUpdatedAt = entry.updatedAt ?? null;
      }
      continue;
    }
    byKey.set(entry.key, {
      value: entry.key,
      count: 1,
      latestUpdatedAt: entry.updatedAt ?? null,
    });
  }

  return [...byKey.values()].sort((left, right) => left.value.localeCompare(right.value));
}

export function filterScopedMemoryEntries(
  entries: MemoryEntry[],
  filters: {
    query: string;
    actor: string;
    key: string;
  },
): MemoryEntry[] {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return entries.filter((entry) => {
    if (filters.actor && buildActorFilterValue(entry) !== filters.actor) {
      return false;
    }
    if (filters.key && entry.key !== filters.key) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return buildSearchIndex(entry).includes(normalizedQuery);
  });
}

export function buildMemoryHistoryReview(
  entries: MemoryEntry[],
  selectedKey: string,
  selectedRevisionId: string,
  compareRevisionId = '',
): MemoryHistoryReview {
  const versions = entries.filter((entry) => entry.key === selectedKey);
  const selectedEntry =
    versions.find((entry) => buildMemoryRevisionId(entry) === selectedRevisionId) ??
    versions[0] ??
    null;

  if (!selectedEntry) {
    return {
      versions,
      selectedEntry: null,
      previousEntry: null,
      selectedText: '',
      previousText: '',
    };
  }

  const selectedIndex = versions.findIndex(
    (entry) => buildMemoryRevisionId(entry) === buildMemoryRevisionId(selectedEntry),
  );
  const automaticPreviousEntry = selectedIndex >= 0 ? versions[selectedIndex + 1] ?? null : null;
  const previousEntry =
    versions.find((entry) => buildMemoryRevisionId(entry) === compareRevisionId) ??
    automaticPreviousEntry;

  return {
    versions,
    selectedEntry,
    previousEntry,
    selectedText: stringifyMemoryValue(selectedEntry.value),
    previousText: previousEntry ? stringifyMemoryValue(previousEntry.value) : '',
  };
}

export function buildMemoryRevisionId(entry: MemoryEntry): string {
  return [
    entry.key,
    entry.eventId ?? 'unknown',
    entry.updatedAt ?? 'unknown',
    entry.eventType ?? 'updated',
  ].join(':');
}

export function buildMemoryRevisionOptions(
  entries: MemoryEntry[],
  selectedKey: string,
  selectedRevisionId: string,
): Array<{
  value: string;
  label: string;
  helper: string;
}> {
  return entries
    .filter((entry) => entry.key === selectedKey)
    .filter((entry) => buildMemoryRevisionId(entry) !== selectedRevisionId)
    .map((entry) => ({
      value: buildMemoryRevisionId(entry),
      label: describeMemoryRevisionLabel(entry),
      helper: entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : 'Unknown time',
    }));
}

export function stringifyMemoryValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

export function formatMemoryActor(
  actorType: string | null | undefined,
  actorId: string | null | undefined,
): string {
  if (actorType && actorId) {
    return `${actorType} • ${actorId}`;
  }
  if (actorType) {
    return actorType;
  }
  return 'Unknown author';
}

export function describeMemoryRevisionLabel(entry: MemoryEntry): string {
  const actor = formatMemoryActor(entry.actorType, entry.actorId);
  if (entry.eventType === 'deleted') {
    return `${actor} deleted this key`;
  }
  return `${actor} updated this key`;
}

function buildActorFilterValue(entry: MemoryEntry): string {
  if (!entry.actorType) {
    return '';
  }
  return `${entry.actorType}:${entry.actorId ?? ''}`;
}

function buildSearchIndex(entry: MemoryEntry): string {
  return [
    entry.key,
    stringifyMemoryValue(entry.value),
    entry.stageName,
    entry.taskId,
    entry.workItemId,
    entry.workflowId,
    entry.actorType,
    entry.actorId,
    entry.eventType,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
}
