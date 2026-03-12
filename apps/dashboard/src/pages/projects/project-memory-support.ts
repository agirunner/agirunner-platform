import type {
  DashboardProjectRecord,
  DashboardProjectTimelineEntry,
  DashboardWorkItemMemoryEntry,
  DashboardWorkItemMemoryHistoryEntry,
} from '../../lib/api.js';

export interface MemoryEntry {
  key: string;
  value: unknown;
  scope: 'project' | 'work_item';
  eventId?: number;
  workflowId?: string | null;
  workItemId?: string | null;
  taskId?: string | null;
  stageName?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  updatedAt?: string | null;
  eventType?: 'updated' | 'deleted';
}

export interface RecentWorkflowEntry {
  id: string;
  name: string;
  state: string;
  createdAt: string;
}

export interface ProjectTimelineSummary {
  activeCount: number;
  totalCount: number;
  recentWorkflows: RecentWorkflowEntry[];
}

const ACTIVE_STATES = new Set(['active', 'pending', 'paused']);

export function normalizeProjectList(
  response: { data: DashboardProjectRecord[] } | DashboardProjectRecord[] | undefined,
): DashboardProjectRecord[] {
  if (!response) {
    return [];
  }
  if (Array.isArray(response)) {
    return response;
  }
  return response.data ?? [];
}

export function extractMemoryEntries(
  memory: Record<string, unknown> | undefined,
): MemoryEntry[] {
  if (!memory) {
    return [];
  }
  return Object.entries(memory).map(([key, value]) => ({
    key,
    value,
    scope: 'project',
  }));
}

export function normalizeWorkItemMemoryEntries(
  entries: DashboardWorkItemMemoryEntry[] | undefined,
): MemoryEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry) => ({
    key: entry.key,
    value: entry.value,
    scope: 'work_item',
    eventId: entry.event_id,
    workflowId: entry.workflow_id,
    workItemId: entry.work_item_id,
    taskId: entry.task_id,
    stageName: entry.stage_name,
    actorType: entry.actor_type,
    actorId: entry.actor_id,
    updatedAt: entry.updated_at,
  }));
}

export function normalizeWorkItemMemoryHistoryEntries(
  entries: DashboardWorkItemMemoryHistoryEntry[] | undefined,
): MemoryEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => ({
      key: entry.key,
      value: entry.value,
      scope: 'work_item' as const,
      eventId: entry.event_id,
      workflowId: entry.workflow_id,
      workItemId: entry.work_item_id,
      taskId: entry.task_id,
      stageName: entry.stage_name,
      actorType: entry.actor_type,
      actorId: entry.actor_id,
      updatedAt: entry.updated_at,
      eventType: entry.event_type,
    }))
    .sort((left, right) => {
      const leftTimestamp = left.updatedAt ?? '';
      const rightTimestamp = right.updatedAt ?? '';
      return rightTimestamp.localeCompare(leftTimestamp);
    });
}

export function filterMemoryEntries(entries: MemoryEntry[], query: string): MemoryEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return entries;
  }

  return entries.filter((entry) => {
    const value = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
    const context = [
      entry.scope,
      entry.workflowId,
      entry.workItemId,
      entry.taskId,
      entry.stageName,
      entry.actorType,
      entry.actorId,
    ]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' ')
      .toLowerCase();
    return (
      entry.key.toLowerCase().includes(normalizedQuery) ||
      value.toLowerCase().includes(normalizedQuery) ||
      context.includes(normalizedQuery)
    );
  });
}

export function summarizeProjectTimeline(
  timeline: DashboardProjectTimelineEntry[] | undefined,
): ProjectTimelineSummary {
  if (!timeline) {
    return { activeCount: 0, totalCount: 0, recentWorkflows: [] };
  }

  const seen = new Set<string>();
  const recentWorkflows: RecentWorkflowEntry[] = [];
  let activeCount = 0;

  for (const entry of timeline) {
    if (!entry.workflow_id || seen.has(entry.workflow_id)) {
      continue;
    }

    seen.add(entry.workflow_id);
    const normalizedState = normalizeWorkflowContinuityState(entry.state);
    if (ACTIVE_STATES.has(normalizedState)) {
      activeCount += 1;
    }

    recentWorkflows.push({
      id: entry.workflow_id,
      name: entry.name || entry.workflow_id,
      state: normalizedState,
      createdAt: entry.created_at,
    });
  }

  return {
    activeCount,
    totalCount: recentWorkflows.length,
    recentWorkflows: recentWorkflows.slice(0, 6),
  };
}

function normalizeWorkflowContinuityState(state: string | null | undefined): string {
  const normalized = (state ?? 'unknown').toLowerCase();
  if (normalized === 'running') {
    return 'active';
  }
  if (normalized === 'created') {
    return 'pending';
  }
  return normalized;
}
