import type {
  DashboardProjectRecord,
  DashboardProjectTimelineEntry,
  DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import { normalizeTaskState as normalizeCanonicalTaskState } from '../../lib/task-state.js';

export interface ProjectWorkflowOption {
  id: string;
  name: string;
  state: string;
  createdAt: string;
}

export interface ProjectTaskOption {
  id: string;
  title: string;
  state: string;
  stageName: string | null;
  workItemId: string | null;
  activationId: string | null;
  role: string | null;
  isOrchestratorTask: boolean;
  createdAt?: string;
}

export interface ProjectWorkItemOption {
  id: string;
  title: string;
  stageName: string;
  columnId: string;
  priority: string;
  completedAt?: string | null;
}

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

export function buildWorkflowOptions(
  timeline: DashboardProjectTimelineEntry[] | undefined,
): ProjectWorkflowOption[] {
  if (!timeline) {
    return [];
  }

  const seen = new Set<string>();
  const workflows: ProjectWorkflowOption[] = [];

  for (const entry of timeline) {
    if (!entry.workflow_id || seen.has(entry.workflow_id)) {
      continue;
    }

    seen.add(entry.workflow_id);
    workflows.push({
      id: entry.workflow_id,
      name: entry.name || entry.workflow_id,
      state: normalizeWorkflowState(entry.state),
      createdAt: entry.created_at,
    });
  }

  return workflows;
}

export function normalizeTaskOptions(response: unknown): ProjectTaskOption[] {
  const records = Array.isArray(response)
    ? response
    : ((response as { data?: unknown } | undefined)?.data ?? []);

  if (!Array.isArray(records)) {
    return [];
  }

  const tasks: ProjectTaskOption[] = [];
  for (const record of records) {
    const task = record as Record<string, unknown>;
    const id = typeof task.id === 'string' ? task.id : null;
    if (!id) {
      continue;
    }

    tasks.push({
      id,
      title:
        (typeof task.title === 'string' && task.title) ||
        (typeof task.name === 'string' && task.name) ||
        id,
      state: normalizeTaskState(typeof task.state === 'string' ? task.state : 'unknown'),
      stageName: typeof task.stage_name === 'string' ? task.stage_name : null,
      workItemId: typeof task.work_item_id === 'string' ? task.work_item_id : null,
      activationId: typeof task.activation_id === 'string' ? task.activation_id : null,
      role: typeof task.role === 'string' ? task.role : null,
      isOrchestratorTask: Boolean(task.is_orchestrator_task),
      createdAt: typeof task.created_at === 'string' ? task.created_at : undefined,
    });
  }

  return tasks;
}

export function normalizeWorkItemOptions(
  workItems: DashboardWorkflowWorkItemRecord[] | undefined,
): ProjectWorkItemOption[] {
  if (!Array.isArray(workItems)) {
    return [];
  }

  return workItems
    .filter((item) => typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      title: item.title,
      stageName: item.stage_name,
      columnId: item.column_id,
      priority: item.priority,
      completedAt: item.completed_at ?? null,
    }));
}

export function filterTasksByWorkItem(
  tasks: ProjectTaskOption[],
  workItemId: string,
): ProjectTaskOption[] {
  if (!workItemId) {
    return tasks;
  }
  return tasks.filter((task) => task.workItemId === workItemId);
}

function normalizeWorkflowState(state: string | null | undefined): string {
  const normalized = (state ?? 'unknown').toLowerCase();
  if (normalized === 'running') {
    return 'active';
  }
  if (normalized === 'created') {
    return 'pending';
  }
  return normalized;
}

function normalizeTaskState(state: string | null | undefined): string {
  return normalizeCanonicalTaskState(state ?? 'unknown');
}
