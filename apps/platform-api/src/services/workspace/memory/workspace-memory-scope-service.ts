import type { DatabaseQueryable } from '../../../db/database.js';
import {
  listVisibleTaskMemoryEntries,
  memoryEntryMatchesQuery,
  toScopedMemoryEntry,
} from './workspace-memory-scope-helpers.js';

export interface WorkspaceMemoryMutationContext {
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

const WORKSPACE_MEMORY_EVENT_TYPES = ['workspace.memory_updated', 'workspace.memory_deleted'] as const;

export class WorkspaceMemoryScopeService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async filterVisibleTaskMemory(input: {
    tenantId: string;
    workspaceId: string;
    workflowId: string;
    workItemId: string | null;
    currentMemory: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const visibleEntries = await listVisibleTaskMemoryEntries(this.pool, input);
    return Object.fromEntries(visibleEntries.map((entry) => [entry.key, entry.value]));
  }

  async listWorkItemMemoryEntries(input: {
    tenantId: string;
    workspaceId: string;
    workflowId: string;
    workItemId: string;
    currentMemory: Record<string, unknown>;
  }): Promise<WorkItemMemoryEntry[]> {
    const visibleEntries = await listVisibleTaskMemoryEntries(this.pool, input);
    return visibleEntries
      .filter((entry) => entry.event_type === 'updated')
      .filter((entry) => entry.workflow_id === input.workflowId && entry.work_item_id === input.workItemId)
      .map(({ event_type: _eventType, ...entry }) => entry);
  }

  async listWorkItemMemoryHistory(input: {
    tenantId: string;
    workspaceId: string;
    workflowId: string;
    workItemId: string;
    limit: number;
  }): Promise<WorkItemMemoryHistoryEntry[]> {
    const result = await this.pool.query<{
      id: number;
      type: string;
      actor_type: string;
      actor_id: string | null;
      data: unknown;
      created_at: string;
    }>(
      `SELECT id, type, actor_type, actor_id, data, created_at
         FROM events
        WHERE tenant_id = $1
          AND entity_type = 'workspace'
          AND entity_id = $2
          AND type = ANY($3::text[])
          AND COALESCE(data->>'workflow_id', '') = $4
          AND COALESCE(data->>'work_item_id', '') = $5
        ORDER BY created_at DESC, id DESC
        LIMIT $6`,
      [
        input.tenantId,
        input.workspaceId,
        [...WORKSPACE_MEMORY_EVENT_TYPES],
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
    workspaceId: string;
    workflowId: string;
    workItemId: string | null;
    currentMemory: Record<string, unknown>;
    limit: number;
  }): Promise<{ keys: string[]; total: number; more_available: boolean }> {
    const visibleEntries = await listVisibleTaskMemoryEntries(this.pool, input);
    const limited = visibleEntries.slice(0, Math.max(0, input.limit));
    return {
      keys: limited.map((entry) => entry.key),
      total: visibleEntries.length,
      more_available: visibleEntries.length > limited.length,
    };
  }

  async searchVisibleTaskMemory(input: {
    tenantId: string;
    workspaceId: string;
    workflowId: string;
    workItemId: string | null;
    currentMemory: Record<string, unknown>;
    query: string;
  }): Promise<WorkItemMemoryEntry[]> {
    const query = input.query.trim().toLowerCase();
    if (query.length === 0) {
      return [];
    }

    const visibleEntries = await listVisibleTaskMemoryEntries(this.pool, input);
    return visibleEntries
      .filter((entry) => memoryEntryMatchesQuery(entry, query))
      .map(({ event_type: _eventType, ...entry }) => entry);
  }
}
