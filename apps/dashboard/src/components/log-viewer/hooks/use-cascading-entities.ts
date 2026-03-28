import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../../lib/api.js';
import type {
  DashboardTaskRecord,
} from '../../../lib/api.js';
import type { ComboboxItem } from '../ui/searchable-combobox.js';

interface TaskRecord
  extends Partial<Pick<DashboardTaskRecord, 'id' | 'title' | 'description' | 'workflow_id' | 'role'>> {
  id: string;
  workflow?: { id: string; name?: string | null; workspace_id?: string | null } | null;
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

interface CascadingEntityOverrides {
  workspaces?: ComboboxItem[];
  workflows?: ComboboxItem[];
  tasks?: ComboboxItem[];
  isLoadingWorkspaces?: boolean;
  isLoadingWorkflows?: boolean;
  isLoadingTasks?: boolean;
  isWorkspaceMenuOpen?: boolean;
  isWorkflowMenuOpen?: boolean;
  isTaskMenuOpen?: boolean;
}

export function useCascadingEntities(
  state: CascadingEntityState,
  onChange: (next: CascadingEntityState) => void,
  overrides: CascadingEntityOverrides = {},
): CascadingEntitiesResult {
  const { workspaceId, workflowId, taskId } = state;
  const useWorkspaceOverride = Array.isArray(overrides.workspaces);
  const useWorkflowOverride = Array.isArray(overrides.workflows);
  const useTaskOverride = Array.isArray(overrides.tasks);
  const shouldLoadWorkspaces = overrides.isWorkspaceMenuOpen || Boolean(workspaceId);
  const shouldLoadWorkflows = overrides.isWorkflowMenuOpen || Boolean(workflowId);
  const shouldLoadTasks = overrides.isTaskMenuOpen || Boolean(taskId);

  const workspacesQuery = useQuery({
    queryKey: ['log-filter-workspaces'],
    queryFn: async () => {
      const res = await dashboardApi.listWorkspaces();
      return res.data;
    },
    staleTime: 300_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    enabled: !useWorkspaceOverride && shouldLoadWorkspaces,
  });

  const workflowsQuery = useQuery({
    queryKey: ['log-filter-workflows', workspaceId ?? 'all'],
    queryFn: async () => {
      const filters: Record<string, string> = {};
      if (workspaceId) filters.workspace_id = workspaceId;
      const res = await dashboardApi.getLogWorkflowValues(filters);
      return res.data;
    },
    staleTime: 300_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    enabled: !useWorkflowOverride && shouldLoadWorkflows,
  });

  const tasksQuery = useQuery({
    queryKey: ['log-filter-tasks', workflowId ?? 'all'],
    queryFn: async () => {
      const filters: Record<string, string> = { per_page: '100' };
      if (workflowId) filters.workflow_id = workflowId;
      const res = await dashboardApi.listTasks(filters);
      return extractList<TaskRecord>(res);
    },
    staleTime: 300_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    enabled: !useTaskOverride && shouldLoadTasks,
  });

  const workspaces: ComboboxItem[] = useMemo(
    () =>
      useWorkspaceOverride
        ? overrides.workspaces ?? []
        : (workspacesQuery.data ?? []).map((p) => ({
        id: p.id,
        label: p.name,
      })),
    [overrides.workspaces, useWorkspaceOverride, workspacesQuery.data],
  );

  const workflows: ComboboxItem[] = useMemo(
    () =>
      useWorkflowOverride
        ? overrides.workflows ?? []
        : (workflowsQuery.data ?? []).map((w) => ({
        id: w.id,
        label: w.name ?? w.id,
      })),
    [overrides.workflows, useWorkflowOverride, workflowsQuery.data],
  );

  const tasks: ComboboxItem[] = useMemo(
    () =>
      useTaskOverride
        ? overrides.tasks ?? []
        : (tasksQuery.data ?? []).map((t) => ({
        id: t.id,
        label: t.title ?? t.description ?? t.id,
      })),
    [overrides.tasks, useTaskOverride, tasksQuery.data],
  );

  const setWorkspace = useCallback(
    (id: string | null) => {
      onChange({ workspaceId: id, workflowId: null, taskId: null });
    },
    [onChange],
  );

  const setWorkflow = useCallback(
    (id: string | null) => {
      onChange({ workspaceId, workflowId: id, taskId: null });
    },
    [onChange, workspaceId],
  );

  const setTask = useCallback(
    (id: string | null) => {
      if (id && !workflowId) {
        const task = (tasksQuery.data ?? []).find((t) => t.id === id);
        const inferredWorkflow = task?.workflow_id ?? task?.workflow?.id ?? null;
        if (inferredWorkflow && !workspaceId) {
          const wf = (workflowsQuery.data ?? []).find((w) => w.id === inferredWorkflow);
          const inferredWorkspace = wf?.workspace_id ?? null;
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

  const searchWorkspaces = useCallback((_query: string) => {}, []);

  const searchWorkflows = useCallback((_query: string) => {}, []);

  const searchTasks = useCallback((_query: string) => {}, []);

  return {
    workspaces,
    workflows,
    tasks,
    isLoadingWorkspaces: overrides.isLoadingWorkspaces ?? workspacesQuery.isLoading,
    isLoadingWorkflows: overrides.isLoadingWorkflows ?? workflowsQuery.isLoading,
    isLoadingTasks: overrides.isLoadingTasks ?? tasksQuery.isLoading,
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
