import type { DashboardWorkItemMemoryHistoryEntry } from '../../lib/api.js';
import { shortId } from '../../components/execution-inspector-support.js';
import type { WorkflowInspectorFocusWorkItem } from './workflow-inspector-support.js';

export interface WorkflowInspectorMemoryChange {
  key: string;
  status: 'Created' | 'Updated' | 'Deleted';
  summary: string;
  detail: string;
  occurredAtLabel: string;
  occurredAtTitle: string;
  changedFields: string[];
  previousText: string;
  currentText: string;
  canRenderDiff: boolean;
}

export interface WorkflowInspectorMemoryPacket {
  title: string;
  detail: string;
  emptyMessage: string;
  changes: WorkflowInspectorMemoryChange[];
}

export function buildWorkflowInspectorMemoryPacket(input: {
  focusWorkItem?: WorkflowInspectorFocusWorkItem | null;
  memoryHistory?: DashboardWorkItemMemoryHistoryEntry[];
  now?: number;
}): WorkflowInspectorMemoryPacket {
  const focus = input.focusWorkItem;
  if (!focus) {
    return {
      title: 'Memory evolution',
      detail: 'No active work item is available to anchor a memory evolution packet.',
      emptyMessage: 'As work items start recording memory, the latest key changes will appear here.',
      changes: [],
    };
  }

  const history = [...(input.memoryHistory ?? [])]
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));

  return {
    title: `Memory evolution · ${focus.title}`,
    detail: `Latest recorded memory changes for the ${focus.stageName} work item, with previous values summarized inline so operators can spot drift without opening the project memory browser.`,
    emptyMessage: `No memory history has been recorded for ${focus.title} yet.`,
    changes: history.slice(0, 4).map((entry, index) => {
      const previous = history
        .slice(index + 1)
        .find((candidate) => candidate.key === entry.key);
      const occurredAt = new Date(entry.updated_at);
      const currentValue = entry.event_type === 'deleted' ? null : entry.value;
      return {
        key: entry.key,
        status: entry.event_type === 'deleted'
          ? 'Deleted'
          : previous
            ? 'Updated'
            : 'Created',
        summary: describeMemorySummary(entry, previous),
        detail: describeMemoryDetail(entry),
        occurredAtLabel: describeRelativeTime(occurredAt.getTime(), input.now ?? Date.now()),
        occurredAtTitle: occurredAt.toLocaleString(),
        changedFields: readChangedFields(previous?.value, currentValue),
        previousText: stringifyMemoryValue(previous?.value),
        currentText: stringifyMemoryValue(currentValue),
        canRenderDiff: previous !== undefined || entry.event_type !== 'deleted',
      };
    }),
  };
}

function describeMemorySummary(
  current: DashboardWorkItemMemoryHistoryEntry,
  previous: DashboardWorkItemMemoryHistoryEntry | undefined,
): string {
  if (current.event_type === 'deleted') {
    return previous
      ? `Removed after previously storing ${summarizeMemoryValue(previous.value)}.`
      : 'Removed from the work-item memory packet.';
  }
  if (previous) {
    return `Changed from ${summarizeMemoryValue(previous.value)} to ${summarizeMemoryValue(current.value)}.`;
  }
  return `Recorded ${summarizeMemoryValue(current.value)} for the first time.`;
}

function describeMemoryDetail(entry: DashboardWorkItemMemoryHistoryEntry): string {
  const actor = entry.actor_id ? `${entry.actor_type} ${shortId(entry.actor_id)}` : entry.actor_type;
  const stage = entry.stage_name ? `stage ${entry.stage_name}` : 'workflow scope';
  return `${actor} updated this key in ${stage}.`;
}

function summarizeMemoryValue(value: unknown): string {
  if (value == null) {
    return 'an empty value';
  }
  if (typeof value === 'string') {
    return value.length > 48 ? `"${value.slice(0, 45)}..."` : `"${value}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (
      entries.length > 0
      && entries.length <= 2
      && entries.every(([, entryValue]) =>
        entryValue == null
        || typeof entryValue === 'string'
        || typeof entryValue === 'number'
        || typeof entryValue === 'boolean')
    ) {
      return entries.map(([key, entryValue]) => `${key}: ${String(entryValue)}`).join(', ');
    }
    return `${entries.length} field object`;
  }
  return 'a recorded value';
}

function readChangedFields(previousValue: unknown, currentValue: unknown): string[] {
  const previousRecord = asComparableRecord(previousValue);
  const currentRecord = asComparableRecord(currentValue);
  if (!previousRecord || !currentRecord) {
    if (JSON.stringify(previousValue) === JSON.stringify(currentValue)) {
      return [];
    }
    return ['value'];
  }

  const keys = new Set([
    ...Object.keys(previousRecord),
    ...Object.keys(currentRecord),
  ]);

  return [...keys]
    .filter((key) =>
      JSON.stringify(previousRecord[key] ?? null) !== JSON.stringify(currentRecord[key] ?? null),
    )
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 4);
}

function stringifyMemoryValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return String(value ?? '');
  }
  return JSON.stringify(value, null, 2);
}

function asComparableRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function describeRelativeTime(timestamp: number, now: number): string {
  const deltaMs = now - timestamp;
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    return 'just now';
  }
  const deltaMinutes = Math.floor(deltaMs / 60_000);
  if (deltaMinutes < 1) {
    return 'just now';
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  return `${Math.floor(deltaHours / 24)}d ago`;
}
