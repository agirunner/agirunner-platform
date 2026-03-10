import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../../lib/api.js';
import type { ComboboxItem } from '../ui/searchable-combobox.js';

interface WorkflowRecord {
  id: string;
  name?: string;
  status?: string;
  project_id?: string;
  project?: { id: string; name: string } | null;
  template?: { name: string } | null;
}

interface TaskRecord {
  id: string;
  description?: string;
  status?: string;
  workflow_id?: string;
  workflow?: { id: string; name: string; project_id?: string } | null;
  role?: string;
}

function normalizeStatus(status?: string): ComboboxItem['status'] {
  if (!status) return undefined;
  const s = status.toLowerCase();
  if (s === 'active' || s === 'running' || s === 'in_progress') return 'active';
  if (s === 'completed' || s === 'succeeded') return 'completed';
  if (s === 'failed' || s === 'error') return 'failed';
  return 'pending';
}

export interface CascadingEntityState {
  projectId: string | null;
  workflowId: string | null;
  taskId: string | null;
}

export interface CascadingEntitiesResult {
  projects: ComboboxItem[];
  workflows: ComboboxItem[];
  tasks: ComboboxItem[];
  isLoadingProjects: boolean;
  isLoadingWorkflows: boolean;
  isLoadingTasks: boolean;
  setProject: (id: string | null) => void;
  setWorkflow: (id: string | null) => void;
  setTask: (id: string | null) => void;
  searchProjects: (query: string) => void;
  searchWorkflows: (query: string) => void;
  searchTasks: (query: string) => void;
}

export function useCascadingEntities(
  state: CascadingEntityState,
  onChange: (next: CascadingEntityState) => void,
): CascadingEntitiesResult {
  const { projectId, workflowId, taskId } = state;

  const projectsQuery = useQuery({
    queryKey: ['log-filter-projects'],
    queryFn: async () => {
      const res = await dashboardApi.listProjects();
      return res.data;
    },
    staleTime: 60_000,
  });

  const workflowsQuery = useQuery({
    queryKey: ['log-filter-workflows', projectId ?? 'all'],
    queryFn: async () => {
      const filters: Record<string, string> = { per_page: '100' };
      if (projectId) filters.project_id = projectId;
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

  const projects: ComboboxItem[] = useMemo(
    () =>
      (projectsQuery.data ?? []).map((p) => ({
        id: p.id,
        label: p.name,
      })),
    [projectsQuery.data],
  );

  const workflows: ComboboxItem[] = useMemo(
    () =>
      (workflowsQuery.data ?? []).map((w) => ({
        id: w.id,
        label: w.name ?? w.id,
        subtitle: w.project?.name ?? w.template?.name ?? undefined,
        status: normalizeStatus(w.status),
      })),
    [workflowsQuery.data],
  );

  const tasks: ComboboxItem[] = useMemo(
    () =>
      (tasksQuery.data ?? []).map((t) => ({
        id: t.id,
        label: t.description ?? t.id,
        subtitle: t.role ?? undefined,
        status: normalizeStatus(t.status),
      })),
    [tasksQuery.data],
  );

  const setProject = useCallback(
    (id: string | null) => {
      onChange({ projectId: id, workflowId: null, taskId: null });
    },
    [onChange],
  );

  const setWorkflow = useCallback(
    (id: string | null) => {
      if (id && !projectId) {
        const wf = (workflowsQuery.data ?? []).find((w) => w.id === id);
        const inferredProject = wf?.project_id ?? wf?.project?.id ?? null;
        onChange({ projectId: inferredProject, workflowId: id, taskId: null });
        return;
      }
      onChange({ projectId, workflowId: id, taskId: null });
    },
    [onChange, projectId, workflowsQuery.data],
  );

  const setTask = useCallback(
    (id: string | null) => {
      if (id && !workflowId) {
        const task = (tasksQuery.data ?? []).find((t) => t.id === id);
        const inferredWorkflow = task?.workflow_id ?? task?.workflow?.id ?? null;
        if (inferredWorkflow && !projectId) {
          const wf = (workflowsQuery.data ?? []).find((w) => w.id === inferredWorkflow);
          const inferredProject = wf?.project_id ?? wf?.project?.id ?? null;
          onChange({
            projectId: inferredProject,
            workflowId: inferredWorkflow,
            taskId: id,
          });
          return;
        }
        onChange({ projectId, workflowId: inferredWorkflow, taskId: id });
        return;
      }
      onChange({ projectId, workflowId, taskId: id });
    },
    [onChange, projectId, workflowId, tasksQuery.data, workflowsQuery.data],
  );

  const { refetch: refetchProjects } = projectsQuery;
  const { refetch: refetchWorkflows } = workflowsQuery;
  const { refetch: refetchTasks } = tasksQuery;

  const searchProjects = useCallback(
    (_query: string) => { refetchProjects(); },
    [refetchProjects],
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
    projects,
    workflows,
    tasks,
    isLoadingProjects: projectsQuery.isLoading,
    isLoadingWorkflows: workflowsQuery.isLoading,
    isLoadingTasks: tasksQuery.isLoading,
    setProject,
    setWorkflow,
    setTask,
    searchProjects,
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
