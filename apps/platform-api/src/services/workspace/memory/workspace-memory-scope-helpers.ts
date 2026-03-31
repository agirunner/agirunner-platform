import type { DatabaseQueryable } from '../../../db/database.js';
import { sanitizeSecretLikeRecord } from '../../secret-redaction.js';

const WORKSPACE_MEMORY_EVENT_TYPES = ['workspace.memory_updated', 'workspace.memory_deleted'] as const;
const WORKSPACE_MEMORY_SECRET_REDACTION = 'redacted://workspace-memory-secret';

interface EventRow {
  id: number;
  type: string;
  actor_type: string;
  actor_id: string | null;
  data: unknown;
  created_at: string;
}

export interface ScopedMemoryEntry {
  key: string;
  value: unknown;
  event_id: number;
  event_type: 'updated' | 'deleted';
  updated_at: string;
  actor_type: string;
  actor_id: string | null;
  workflow_id: string | null;
  work_item_id: string | null;
  task_id: string | null;
  stage_name: string | null;
}

export async function listVisibleTaskMemoryEntries(
  pool: DatabaseQueryable,
  input: {
    tenantId: string;
    workspaceId: string;
    workflowId: string;
    workItemId: string | null;
    currentMemory: Record<string, unknown>;
  },
) {
  const keys = Object.keys(input.currentMemory);
  if (keys.length === 0) {
    return [];
  }

  const result = await pool.query<EventRow>(
    `SELECT DISTINCT ON ((data->>'key'))
            id, type, actor_type, actor_id, data, created_at
       FROM events
      WHERE tenant_id = $1
        AND entity_type = 'workspace'
        AND entity_id = $2
        AND type = ANY($3::text[])
        AND data->>'key' = ANY($4::text[])
      ORDER BY (data->>'key'), created_at DESC, id DESC`,
    [input.tenantId, input.workspaceId, [...WORKSPACE_MEMORY_EVENT_TYPES], keys],
  );

  const scopedEntries = result.rows
    .map((row) => toScopedMemoryEntry(row, input.currentMemory))
    .filter((entry): entry is ScopedMemoryEntry => entry !== null);
  const visibleEventEntries = scopedEntries.filter((entry) =>
    isVisibleToTask(entry, input.workflowId, input.workItemId),
  );
  const eventKeys = new Set(scopedEntries.map((entry) => entry.key));
  const fallbackEntries = keys
    .filter((key) => !eventKeys.has(key))
    .map((key) => createFallbackMemoryEntry(key, input.currentMemory[key]));

  return [...visibleEventEntries, ...fallbackEntries].sort(compareMemoryEntriesByRecency);
}

export function memoryEntryMatchesQuery(
  entry: Pick<ScopedMemoryEntry, 'key' | 'value'>,
  query: string,
) {
  if (entry.key.toLowerCase().includes(query)) {
    return true;
  }
  return serializeMemoryValue(entry.value).toLowerCase().includes(query);
}

export function toScopedMemoryEntry(
  row: {
    id: number;
    type: string;
    actor_type: string;
    actor_id: string | null;
    data: unknown;
    created_at: string;
  },
  currentMemory?: Record<string, unknown>,
): ScopedMemoryEntry | null {
  const data = asRecord(row.data);
  const key = readString(data.key);
  if (!key) {
    return null;
  }

  const eventType = row.type === 'workspace.memory_deleted' ? 'deleted' : 'updated';
  const value =
    eventType === 'deleted'
      ? data.deleted_value
      : currentMemory && key in currentMemory
        ? currentMemory[key]
        : data.value;

  return {
    key,
    value: sanitizeMemoryValue(key, value),
    event_id: row.id,
    event_type: eventType,
    updated_at: row.created_at,
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    workflow_id: readNullableString(data.workflow_id),
    work_item_id: readNullableString(data.work_item_id),
    task_id: readNullableString(data.task_id),
    stage_name: readNullableString(data.stage_name),
  };
}

function isVisibleToTask(
  entry: Pick<ScopedMemoryEntry, 'workflow_id'>,
  workflowId: string,
  _workItemId: string | null,
): boolean {
  if (entry.workflow_id && entry.workflow_id !== workflowId) {
    return false;
  }
  return true;
}

function compareMemoryEntriesByRecency(
  left: Pick<ScopedMemoryEntry, 'updated_at' | 'event_id'>,
  right: Pick<ScopedMemoryEntry, 'updated_at' | 'event_id'>,
) {
  const leftTime = toSortableTimestamp(left.updated_at);
  const rightTime = toSortableTimestamp(right.updated_at);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return right.event_id - left.event_id;
}

function createFallbackMemoryEntry(key: string, value: unknown): ScopedMemoryEntry {
  return {
    key,
    value: sanitizeMemoryValue(key, value),
    event_id: 0,
    event_type: 'updated',
    updated_at: '',
    actor_type: 'system',
    actor_id: null,
    workflow_id: null,
    work_item_id: null,
    task_id: null,
    stage_name: null,
  };
}

function toSortableTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sanitizeMemoryValue(key: string, value: unknown): unknown {
  return sanitizeSecretLikeRecord(
    { [key]: value },
    { redactionValue: WORKSPACE_MEMORY_SECRET_REDACTION, allowSecretReferences: false },
  )[key];
}

function serializeMemoryValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
