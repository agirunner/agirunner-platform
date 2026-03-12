import type {
  DashboardEventRecord,
  DashboardTaskArtifactRecord,
  DashboardWorkItemMemoryEntry,
  DashboardWorkItemMemoryHistoryEntry,
  DashboardWorkflowWorkItemRecord,
} from '../lib/api.js';

export interface DashboardWorkItemTaskRecord {
  id: string;
  title: string;
  state: string;
  role: string | null;
  stage_name: string | null;
  work_item_id: string | null;
  created_at?: string;
  completed_at: string | null;
  depends_on: string[];
}

export interface DashboardWorkItemArtifactRecord extends DashboardTaskArtifactRecord {
  task_title: string;
}

export interface DashboardGroupedWorkItemRecord extends DashboardWorkflowWorkItemRecord {
  children_count?: number;
  children_completed?: number;
  is_milestone?: boolean;
  children?: DashboardGroupedWorkItemRecord[];
}

export function normalizeWorkItemTasks(response: unknown): DashboardWorkItemTaskRecord[] {
  const records = Array.isArray(asWrappedList(response)) ? asWrappedList(response) : [];
  const normalized: DashboardWorkItemTaskRecord[] = [];
  for (const record of records) {
    const item = asRecord(record);
    const id = readString(item.id);
    if (!id) {
      continue;
    }
    normalized.push({
      id,
      title: readString(item.title) ?? readString(item.name) ?? id,
      state: readString(item.state) ?? readString(item.status) ?? 'unknown',
      role: readString(item.role) ?? null,
      stage_name: readString(item.stage_name) ?? null,
      work_item_id: readString(item.work_item_id) ?? null,
      created_at: readString(item.created_at),
      completed_at: readString(item.completed_at) ?? null,
      depends_on: readStringArray(item.depends_on),
    });
  }
  return normalized;
}

export function selectTasksForWorkItem(
  tasks: DashboardWorkItemTaskRecord[],
  workItemId: string,
  workItems?: DashboardGroupedWorkItemRecord[],
): DashboardWorkItemTaskRecord[] {
  const relatedIds = new Set([workItemId]);
  const selectedItem = workItems ? findWorkItemById(workItems, workItemId) : null;
  for (const child of selectedItem?.children ?? []) {
    relatedIds.add(child.id);
  }
  return tasks.filter((task) => task.work_item_id && relatedIds.has(task.work_item_id));
}

export function groupWorkflowWorkItems(
  workItems: DashboardWorkflowWorkItemRecord[],
): DashboardGroupedWorkItemRecord[] {
  const grouped = new Map<string, DashboardGroupedWorkItemRecord>();
  const roots: DashboardGroupedWorkItemRecord[] = [];

  for (const item of workItems) {
    grouped.set(item.id, { ...item, children: [] });
  }

  for (const item of grouped.values()) {
    const parentId = item.parent_work_item_id ?? null;
    if (!parentId) {
      roots.push(item);
      continue;
    }
    const parent = grouped.get(parentId);
    if (!parent) {
      roots.push(item);
      continue;
    }
    parent.children = [...(parent.children ?? []), item];
  }

  return roots;
}

export function flattenGroupedWorkItems(
  workItems: DashboardGroupedWorkItemRecord[],
): DashboardGroupedWorkItemRecord[] {
  const flattened: DashboardGroupedWorkItemRecord[] = [];
  for (const item of workItems) {
    flattened.push(item);
    flattened.push(...(item.children ?? []));
  }
  return flattened;
}

export function findWorkItemById(
  workItems: DashboardGroupedWorkItemRecord[],
  workItemId: string,
): DashboardGroupedWorkItemRecord | null {
  for (const item of workItems) {
    if (item.id === workItemId) {
      return item;
    }
    for (const child of item.children ?? []) {
      if (child.id === workItemId) {
        return child;
      }
    }
  }
  return null;
}

export function isMilestoneWorkItem(workItem: DashboardGroupedWorkItemRecord | null | undefined): boolean {
  if (!workItem) {
    return false;
  }
  return (workItem.children?.length ?? 0) > 0 || (workItem.children_count ?? 0) > 0 || workItem.is_milestone === true;
}

export function flattenArtifactsByTask(
  tasks: DashboardWorkItemTaskRecord[],
  artifactSets: DashboardTaskArtifactRecord[][],
): DashboardWorkItemArtifactRecord[] {
  const taskTitles = new Map(tasks.map((task) => [task.id, task.title]));
  return artifactSets
    .flatMap((artifacts) => artifacts)
    .map((artifact) => ({
      ...artifact,
      task_title: taskTitles.get(artifact.task_id) ?? artifact.task_id,
    }))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function sortEventsNewestFirst(events: DashboardEventRecord[]): DashboardEventRecord[] {
  return [...events].sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function sortMemoryEntriesByKey(
  entries: DashboardWorkItemMemoryEntry[],
): DashboardWorkItemMemoryEntry[] {
  return [...entries].sort((left, right) => left.key.localeCompare(right.key));
}

export function sortMemoryHistoryNewestFirst(
  history: DashboardWorkItemMemoryHistoryEntry[],
): DashboardWorkItemMemoryHistoryEntry[] {
  return [...history].sort((left, right) => {
    if (left.updated_at === right.updated_at) {
      return right.event_id - left.event_id;
    }
    return right.updated_at.localeCompare(left.updated_at);
  });
}

function asWrappedList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const wrapped = asRecord(value);
  return Array.isArray(wrapped.data) ? wrapped.data : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}
