import type { DatabasePool } from '../db/database.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';

export interface ProjectMemoryMutationContext {
  workflow_id?: string | null;
  work_item_id?: string | null;
  task_id?: string | null;
  stage_name?: string | null;
}

export interface WorkItemMemoryEntry {
  key: string;
  value: unknown;
  event_id: number;
  updated_at: string;
  actor_type: string;
  actor_id: string | null;
  workflow_id: string | null;
  work_item_id: string | null;
  task_id: string | null;
  stage_name: string | null;
}

export interface WorkItemMemoryHistoryEntry extends WorkItemMemoryEntry {
  event_type: 'updated' | 'deleted';
}

const PROJECT_MEMORY_EVENT_TYPES = ['project.memory_updated', 'project.memory_deleted'] as const;
const PROJECT_MEMORY_SECRET_REDACTION = 'redacted://project-memory-secret';

interface EventRow {
  id: number;
  type: string;
  actor_type: string;
  actor_id: string | null;
  data: unknown;
  created_at: string;
}

export class ProjectMemoryScopeService {
  constructor(private readonly pool: DatabasePool) {}

  async filterVisibleTaskMemory(input: {
    tenantId: string;
    projectId: string;
    workflowId: string;
    workItemId: string | null;
    currentMemory: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const keys = Object.keys(input.currentMemory);
    if (keys.length === 0) {
      return {};
    }

    const result = await this.pool.query<EventRow>(
      `SELECT DISTINCT ON ((data->>'key'))
              id, type, actor_type, actor_id, data, created_at
         FROM events
        WHERE tenant_id = $1
          AND entity_type = 'project'
          AND entity_id = $2
          AND type = ANY($3::text[])
          AND data->>'key' = ANY($4::text[])
        ORDER BY (data->>'key'), created_at DESC, id DESC`,
      [input.tenantId, input.projectId, [...PROJECT_MEMORY_EVENT_TYPES], keys],
    );

    const visibleMemory = { ...input.currentMemory };
    for (const row of result.rows) {
      const entry = toScopedMemoryEntry(row, input.currentMemory);
      if (!entry) {
        continue;
      }
      if (!isVisibleToTask(entry, input.workflowId, input.workItemId)) {
        delete visibleMemory[entry.key];
      }
    }
    return visibleMemory;
  }

  async listWorkItemMemoryEntries(input: {
    tenantId: string;
    projectId: string;
    workflowId: string;
    workItemId: string;
    currentMemory: Record<string, unknown>;
  }): Promise<WorkItemMemoryEntry[]> {
    const keys = Object.keys(input.currentMemory);
    if (keys.length === 0) {
      return [];
    }

    const result = await this.pool.query<EventRow>(
      `SELECT DISTINCT ON ((data->>'key'))
              id, type, actor_type, actor_id, data, created_at
         FROM events
        WHERE tenant_id = $1
          AND entity_type = 'project'
          AND entity_id = $2
          AND type = ANY($3::text[])
          AND data->>'key' = ANY($4::text[])
        ORDER BY (data->>'key'), created_at DESC, id DESC`,
      [input.tenantId, input.projectId, [...PROJECT_MEMORY_EVENT_TYPES], keys],
    );

    const entries: WorkItemMemoryEntry[] = [];
    for (const row of result.rows) {
      const entry = toScopedMemoryEntry(row, input.currentMemory);
      if (!entry || entry.event_type !== 'updated') {
        continue;
      }
      if (entry.workflow_id !== input.workflowId || entry.work_item_id !== input.workItemId) {
        continue;
      }
      entries.push({
        key: entry.key,
        value: entry.value,
        event_id: entry.event_id,
        updated_at: entry.updated_at,
        actor_type: entry.actor_type,
        actor_id: entry.actor_id,
        workflow_id: entry.workflow_id,
        work_item_id: entry.work_item_id,
        task_id: entry.task_id,
        stage_name: entry.stage_name,
      });
    }
    return entries;
  }

  async listWorkItemMemoryHistory(input: {
    tenantId: string;
    projectId: string;
    workflowId: string;
    workItemId: string;
    limit: number;
  }): Promise<WorkItemMemoryHistoryEntry[]> {
    const result = await this.pool.query<EventRow>(
      `SELECT id, type, actor_type, actor_id, data, created_at
         FROM events
        WHERE tenant_id = $1
          AND entity_type = 'project'
          AND entity_id = $2
          AND type = ANY($3::text[])
          AND COALESCE(data->>'workflow_id', '') = $4
          AND COALESCE(data->>'work_item_id', '') = $5
        ORDER BY created_at DESC, id DESC
        LIMIT $6`,
      [
        input.tenantId,
        input.projectId,
        [...PROJECT_MEMORY_EVENT_TYPES],
        input.workflowId,
        input.workItemId,
        input.limit,
      ],
    );

    return result.rows
      .map((row) => toScopedMemoryEntry(row))
      .filter((entry): entry is WorkItemMemoryHistoryEntry => entry !== null);
  }

  async listVisibleTaskMemoryKeys(input: {
    tenantId: string;
    projectId: string;
    workflowId: string;
    workItemId: string | null;
    currentMemory: Record<string, unknown>;
    limit: number;
  }): Promise<{ keys: string[]; total: number; more_available: boolean }> {
    const keys = Object.keys(input.currentMemory);
    if (keys.length === 0) {
      return { keys: [], total: 0, more_available: false };
    }

    const result = await this.pool.query<EventRow>(
      `SELECT DISTINCT ON ((data->>'key'))
              id, type, actor_type, actor_id, data, created_at
         FROM events
        WHERE tenant_id = $1
          AND entity_type = 'project'
          AND entity_id = $2
          AND type = ANY($3::text[])
          AND data->>'key' = ANY($4::text[])
        ORDER BY (data->>'key'), created_at DESC, id DESC`,
      [input.tenantId, input.projectId, [...PROJECT_MEMORY_EVENT_TYPES], keys],
    );

    const visibleEntries = result.rows
      .map((row) => toScopedMemoryEntry(row, input.currentMemory))
      .filter((entry): entry is WorkItemMemoryHistoryEntry & { key: string } => entry !== null)
      .filter((entry) => isVisibleToTask(entry, input.workflowId, input.workItemId))
      .sort(compareMemoryEntriesByRecency);

    const limited = visibleEntries.slice(0, Math.max(0, input.limit));
    return {
      keys: limited.map((entry) => entry.key),
      total: visibleEntries.length,
      more_available: visibleEntries.length > limited.length,
    };
  }
}

function toScopedMemoryEntry(
  row: EventRow,
  currentMemory?: Record<string, unknown>,
): (WorkItemMemoryHistoryEntry & { key: string }) | null {
  const data = asRecord(row.data);
  const key = readString(data.key);
  if (!key) {
    return null;
  }

  const eventType = row.type === 'project.memory_deleted' ? 'deleted' : 'updated';
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
    { redactionValue: PROJECT_MEMORY_SECRET_REDACTION, allowSecretReferences: false },
  )[key];
}

function isVisibleToTask(
  entry: Pick<WorkItemMemoryEntry, 'workflow_id' | 'work_item_id'>,
  workflowId: string,
  workItemId: string | null,
): boolean {
  if (entry.workflow_id && entry.workflow_id !== workflowId) {
    return false;
  }
  if (entry.work_item_id) {
    return workItemId !== null && entry.work_item_id === workItemId;
  }
  return true;
}

function compareMemoryEntriesByRecency(
  left: Pick<WorkItemMemoryHistoryEntry, 'updated_at' | 'event_id'>,
  right: Pick<WorkItemMemoryHistoryEntry, 'updated_at' | 'event_id'>,
) {
  const leftTime = Date.parse(left.updated_at);
  const rightTime = Date.parse(right.updated_at);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return right.event_id - left.event_id;
}
