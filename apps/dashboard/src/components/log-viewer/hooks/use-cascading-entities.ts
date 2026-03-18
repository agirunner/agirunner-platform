import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../../lib/api.js';
import type {
  DashboardTaskRecord,
  DashboardTaskState,
  DashboardWorkflowRecord,
  DashboardWorkflowState,
} from '../../../lib/api.js';
import type { ComboboxItem } from '../ui/searchable-combobox.js';

interface WorkflowRecord extends Partial<Pick<DashboardWorkflowRecord, 'id' | 'name' | 'workspace_id'>> {
  id: string;
  state?: DashboardWorkflowState;
  status?: string;
  workspace?: { id: string; name: string } | null;
}

interface TaskRecord
  extends Partial<Pick<DashboardTaskRecord, 'id' | 'title' | 'description' | 'workflow_id' | 'role'>> {
  id: string;
  state?: DashboardTaskState;
  status?: string;
  workflow?: { id: string; name?: string | null; workspace_id?: string | null } | null;
}

export function normalizeEntityStatus(status?: string): ComboboxItem['status'] {
  if (!status) return undefined;
  const s = status.toLowerCase();
  if (s === 'active' || s === 'in_progress') return 'active';
  if (s === 'completed' || s === 'succeeded') return 'completed';
  if (s === 'failed' || s === 'error') return 'failed';
  return 'pending';
}

export function readWorkflowEntityStatus(workflow: WorkflowRecord): ComboboxItem['status'] {
  return normalizeEntityStatus(workflow.state ?? workflow.status);
}

export function readTaskEntityStatus(task: TaskRecord): ComboboxItem['status'] {
  return normalizeEntityStatus(task.state ?? task.status);
}

export interface CascadingEntityState {
  workspaceId: string | null;
  workflowId: string | null;
  taskId: string | null;
}

export interface CascadingEntitiesResult {
  workspaces: ComboboxItem[];
  workflows: ComboboxItem[];
  tasks: ComboboxItem[];
  isLoadingWorkspaces: boolean;
  isLoadingWorkflows: boolean;
  isLoadingTasks: boolean;
  setWorkspace: (id: string | null) => void;
  setWorkflow: (id: string | null) => void;
  setTask: (id: string | null) => void;
  searchWorkspaces: (query: string) => void;
  searchWorkflows: (query: string) => void;
  searchTasks: (query: string) => void;
}

export function useCascadingEntities(
  state: CascadingEntityState,
  onChange: (next: CascadingEntityState) => void,
): CascadingEntitiesResult {
  const { workspaceId, workflowId, taskId } = state;

  const workspacesQuery = useQuery({
    queryKey: ['log-filter-workspaces'],
    queryFn: async () => {
      const res = await dashboardApi.listWorkspaces();
      return res.data;
    },
    staleTime: 60_000,
  });

  const workflowsQuery = useQuery({
    queryKey: ['log-filter-workflows', workspaceId ?? 'all'],
    queryFn: async () => {
      const filters: Record<string, string> = { per_page: '100' };
      if (workspaceId) filters.workspace_id = workspaceId;
      const res = await dashboardApi.listWorkflows(filters);
      return extractList<WorkflowRecord>(res);
    },
    staleTime: 30_000,
  });

  const tasksQuery = useQuery({
    queryKey: ['log-filter-tasks', workflowId ?? 'all'],
    queryFn: async () => {
      const filters: Record<string, string> = { per_page: '100' };
      if (workflowId) filters.workflow_id = workflowId;
      const res = await dashboardApi.listTasks(filters);
      return extractList<TaskRecord>(res);
    },
    staleTime: 30_000,
  });

  const workspaces: ComboboxItem[] = useMemo(
    () =>
      (workspacesQuery.data ?? []).map((p) => ({
        id: p.id,
        label: p.name,
      })),
    [workspacesQuery.data],
  );

  const workflows: ComboboxItem[] = useMemo(
    () =>
      (workflowsQuery.data ?? []).map((w) => ({
        id: w.id,
        label: w.name ?? w.id,
        subtitle: w.workspace?.name ?? undefined,
        status: readWorkflowEntityStatus(w),
      })),
    [workflowsQuery.data],
  );

  const tasks: ComboboxItem[] = useMemo(
    () =>
      (tasksQuery.data ?? []).map((t) => ({
        id: t.id,
        label: t.title ?? t.description ?? t.id,
        subtitle: t.role ?? undefined,
        status: readTaskEntityStatus(t),
      })),
    [tasksQuery.data],
  );

  const setWorkspace = useCallback(
    (id: string | null) => {
      onChange({ workspaceId: id, workflowId: null, taskId: null });
    },
    [onChange],
  );

  const setWorkflow = useCallback(
    (id: string | null) => {
      if (id && !workspaceId) {
        const wf = (workflowsQuery.data ?? []).find((w) => w.id === id);
        const inferredWorkspace = wf?.workspace_id ?? wf?.workspace?.id ?? null;
        onChange({ workspaceId: inferredWorkspace, workflowId: id, taskId: null });
        return;
      }
      onChange({ workspaceId, workflowId: id, taskId: null });
    },
    [onChange, workspaceId, workflowsQuery.data],
  );

  const setTask = useCallback(
    (id: string | null) => {
      if (id && !workflowId) {
        const task = (tasksQuery.data ?? []).find((t) => t.id === id);
        const inferredWorkflow = task?.workflow_id ?? task?.workflow?.id ?? null;
        if (inferredWorkflow && !workspaceId) {
          const wf = (workflowsQuery.data ?? []).find((w) => w.id === inferredWorkflow);
          const inferredWorkspace = wf?.workspace_id ?? wf?.workspace?.id ?? null;
          onChange({
            workspaceId: inferredWorkspace,
            workflowId: inferredWorkflow,
            taskId: id,
          });
          return;
        }
        onChange({ workspaceId, workflowId: inferredWorkflow, taskId: id });
        return;
      }
      onChange({ workspaceId, workflowId, taskId: id });
    },
    [onChange, workspaceId, workflowId, tasksQuery.data, workflowsQuery.data],
  );

  const { refetch: refetchWorkspaces } = workspacesQuery;
  const { refetch: refetchWorkflows } = workflowsQuery;
  const { refetch: refetchTasks } = tasksQuery;

  const searchWorkspaces = useCallback(
    (_query: string) => { refetchWorkspaces(); },
    [refetchWorkspaces],
  );

  const searchWorkflows = useCallback(
    (_query: string) => { refetchWorkflows(); },
    [refetchWorkflows],
  );

  const searchTasks = useCallback(
    (_query: string) => { refetchTasks(); },
    [refetchTasks],
  );

  return {
    workspaces,
    workflows,
    tasks,
    isLoadingWorkspaces: workspacesQuery.isLoading,
    isLoadingWorkflows: workflowsQuery.isLoading,
    isLoadingTasks: tasksQuery.isLoading,
    setWorkspace,
    setWorkflow,
    setTask,
    searchWorkspaces,
    searchWorkflows,
    searchTasks,
  };
}

function extractList<T>(response: unknown): T[] {
  if (!response || typeof response !== 'object') return [];
  if (Array.isArray(response)) return response as T[];
  const obj = response as Record<string, unknown>;
  if (Array.isArray(obj.data)) return obj.data as T[];
  return [];
}
