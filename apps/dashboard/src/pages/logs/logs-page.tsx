import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardTaskRecord,
  DashboardWorkflowRecord,
  DashboardWorkspaceRecord,
} from '../../lib/api.js';
import { ExecutionInspectorSummaryView } from '../../components/execution-inspector/execution-inspector-summary-view.js';
import { WorkflowBudgetCard } from '../../components/workflow-budget-card/workflow-budget-card.js';
import { type InspectorView } from '../../components/execution-inspector/execution-inspector-support.js';
import { LogFilters } from '../../components/log-viewer/log-filters.js';
import { LogViewer } from '../../components/log-viewer/log-viewer.js';
import {
  toActorItems,
  toOperationItems,
  toRoleItems,
} from '../../components/log-viewer/log-filters.support.js';
import { useLogFilters } from '../../components/log-viewer/hooks/use-log-filters.js';
import { applyLogScope, type LogScope } from '../../components/log-viewer/log-scope.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { readLogsSurfaceView } from './logs-page-view.js';
import type { ComboboxItem } from '../../components/log-viewer/ui/searchable-combobox.js';

interface LogsPageProps {
  scopedWorkflowId?: string;
  mode?: 'logs' | 'inspector';
}

export function LogsPage(): JSX.Element {
  return <LogsSurface mode="logs" />;
}

export function LogsSurface(props: LogsPageProps = {}): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const scopedWorkflowId = props.scopedWorkflowId?.trim() ?? '';
  const surfaceMode = props.mode ?? (scopedWorkflowId ? 'inspector' : 'logs');
  const rawFirstSurface = surfaceMode === 'logs';
  const selectedView = useMemo(() => readLogsSurfaceView(searchParams), [searchParams]);
  const isSummaryView = selectedView === 'summary';
  const { filters, toQueryParams } = useLogFilters();
  const logScope = useMemo<LogScope | undefined>(
    () => (scopedWorkflowId ? { workflowId: scopedWorkflowId } : undefined),
    [scopedWorkflowId],
  );
  const optionBaseFilters = useMemo(
    () => applyLogScope(toQueryParams(), logScope),
    [logScope, toQueryParams],
  );
  const operationOptionFilters = useMemo(() => {
    const next = { ...optionBaseFilters };
    delete next.operation;
    return next;
  }, [optionBaseFilters]);
  const roleOptionFilters = useMemo(() => {
    const next = { ...optionBaseFilters };
    delete next.role;
    return next;
  }, [optionBaseFilters]);
  const actorOptionFilters = useMemo(() => {
    const next = { ...optionBaseFilters };
    delete next.actor_kind;
    return next;
  }, [optionBaseFilters]);
  const statsQuery = useQuery({
    queryKey: ['operator-log', 'stats', filters, logScope],
    queryFn: () => dashboardApi.getLogStats({ ...applyLogScope(toQueryParams(), logScope), group_by: 'category' }),
    enabled: selectedView === 'summary',
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
  const budgetQuery = useQuery({
    queryKey: ['workflow-budget', scopedWorkflowId],
    queryFn: () => dashboardApi.getWorkflowBudget(scopedWorkflowId),
    enabled: scopedWorkflowId.length > 0,
    refetchInterval: 10_000,
  });
  const operationsQuery = useQuery({
    queryKey: ['operator-log', 'operations', filters, logScope],
    queryFn: () => dashboardApi.getLogOperations(operationOptionFilters),
    enabled: true,
    staleTime: 300_000,
  });
  const rolesQuery = useQuery({
    queryKey: ['operator-log', 'roles', filters, logScope],
    queryFn: () => dashboardApi.getLogRoles(roleOptionFilters),
    enabled: true,
    staleTime: 300_000,
  });
  const actorsQuery = useQuery({
    queryKey: ['operator-log', 'actors', filters, logScope],
    queryFn: () => dashboardApi.getLogActors(actorOptionFilters),
    enabled: true,
    staleTime: 300_000,
  });
  const workspacesQuery = useQuery({
    queryKey: ['operator-log', 'filter-workspaces'],
    queryFn: async () => {
      const response = await dashboardApi.listWorkspaces();
      return response.data;
    },
    enabled: true,
    staleTime: 300_000,
  });
  const workflowsQuery = useQuery({
    queryKey: ['operator-log', 'filter-workflows', filters.workspace, logScope],
    queryFn: async () => {
      const requestFilters: Record<string, string> = { per_page: '100' };
      if (logScope?.workflowId) {
        requestFilters.workflow_id = logScope.workflowId;
      } else if (filters.workspace) {
        requestFilters.workspace_id = filters.workspace;
      }
      const response = await dashboardApi.listWorkflows(requestFilters);
      return extractList<DashboardWorkflowRecord>(response);
    },
    enabled: true,
    staleTime: 300_000,
  });
  const tasksQuery = useQuery({
    queryKey: ['operator-log', 'filter-tasks', filters.workflow, logScope],
    queryFn: async () => {
      const requestFilters: Record<string, string> = { per_page: '100' };
      const effectiveWorkflowId = logScope?.workflowId ?? filters.workflow;
      if (effectiveWorkflowId) {
        requestFilters.workflow_id = effectiveWorkflowId;
      }
      const response = await dashboardApi.listTasks(requestFilters);
      return extractList<DashboardTaskRecord>(response);
    },
    enabled: true,
    staleTime: 300_000,
  });
  const operationItemsOverride = useMemo(
    () => toOperationItems(operationsQuery.data),
    [operationsQuery.data],
  );
  const roleItemsOverride = useMemo(
    () => toRoleItems(rolesQuery.data),
    [rolesQuery.data],
  );
  const actorItemsOverride = useMemo(
    () => toActorItems(actorsQuery.data),
    [actorsQuery.data],
  );
  const workspaceItemsOverride = useMemo(
    () => toWorkspaceItems(workspacesQuery.data ?? []),
    [workspacesQuery.data],
  );
  const workflowItemsOverride = useMemo(
    () => toWorkflowItems(workflowsQuery.data ?? []),
    [workflowsQuery.data],
  );
  const taskItemsOverride = useMemo(
    () => toTaskItems(tasksQuery.data ?? []),
    [tasksQuery.data],
  );

  function updateView(view: InspectorView): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (view !== 'summary') {
          next.delete('view');
        } else {
          next.set('view', 'summary');
        }
        return next;
      },
      { replace: true },
    );
  }

  return (
    <div data-testid="operator-log-surface" className="flex flex-col gap-6 p-4 sm:p-6">
      <section className="grid gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Operator Log</h1>
          <p className="text-sm text-muted">
            {rawFirstSurface
              ? 'Raw logs stay visible as the source of truth. Activity Summary highlights the current filtered results without leaving the stream.'
              : 'Browse raw logs and a single activity summary view without leaving the workflow inspector.'}
          </p>
          {scopedWorkflowId ? (
            <div className="text-sm">
              <Link
                className="underline-offset-4 hover:underline"
                to={`/mission-control/workflows/${scopedWorkflowId}`}
              >
                Back to Workflow
              </Link>
            </div>
          ) : null}
        </div>
      </section>

      {scopedWorkflowId ? (
        <WorkflowBudgetCard
          workflowId={scopedWorkflowId}
          budget={budgetQuery.data}
          isLoading={budgetQuery.isLoading}
          hasError={Boolean(budgetQuery.error)}
          context="inspector"
        />
      ) : null}

      <Tabs value={selectedView} onValueChange={(value) => updateView(value as InspectorView)} className="space-y-4" aria-label="Log view">
        <div className="-mx-1 px-1">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 overflow-visible bg-transparent p-0 sm:inline-flex sm:w-auto sm:grid-cols-none sm:gap-0 sm:overflow-x-auto sm:rounded-lg sm:bg-border/30 sm:p-1">
            <TabsTrigger value="raw" className="h-auto min-h-11 px-3 py-2">
              <span className="sm:hidden">{rawFirstSurface ? 'Logs' : 'Raw'}</span>
              <span className="hidden sm:inline">{rawFirstSurface ? 'Log Stream' : 'Raw Logs'}</span>
            </TabsTrigger>
            <TabsTrigger value="summary" className="h-auto min-h-11 px-3 py-2">
              <span className="sm:hidden">Summary</span>
              <span className="hidden sm:inline">{rawFirstSurface ? 'Activity Summary' : 'Summary'}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {selectedView === 'raw' ? (
          <TabsContent value="raw" id="operator-log-raw-stream" className="space-y-4">
            <p className="text-sm leading-6 text-muted">
              Chronological raw logs and events across the current filters. Expand any row to
              inspect payload, error detail, and recorded execution context.
            </p>
            <LogViewer
              compact
              scope={scopedWorkflowId ? { workflowId: scopedWorkflowId } : undefined}
              operationItemsOverride={operationItemsOverride}
              roleItemsOverride={roleItemsOverride}
              actorItemsOverride={actorItemsOverride}
              workspaceItemsOverride={workspaceItemsOverride}
              workflowItemsOverride={workflowItemsOverride}
              taskItemsOverride={taskItemsOverride}
              isLoadingWorkspacesOverride={workspacesQuery.isLoading}
              isLoadingWorkflowsOverride={workflowsQuery.isLoading}
              isLoadingTasksOverride={tasksQuery.isLoading}
            />
          </TabsContent>
        ) : null}

        {selectedView === 'summary' ? (
          <TabsContent value="summary" id="operator-log-summary" className="space-y-4">
            <p className="text-sm leading-6 text-muted">
              A curated summary of the current log results. Top activity paths, role lanes, and
              agent or operator activity reflect the current filters.
            </p>
             <LogFilters
              hideEntityScope={Boolean(logScope)}
              compact
               disableOptionQueries
               scope={logScope}
               operationItemsOverride={operationItemsOverride}
               roleItemsOverride={roleItemsOverride}
               actorItemsOverride={actorItemsOverride}
               workspaceItemsOverride={workspaceItemsOverride}
               workflowItemsOverride={workflowItemsOverride}
               taskItemsOverride={taskItemsOverride}
               isLoadingWorkspacesOverride={workspacesQuery.isLoading}
               isLoadingWorkflowsOverride={workflowsQuery.isLoading}
               isLoadingTasksOverride={tasksQuery.isLoading}
             />
            <ExecutionInspectorSummaryView
              stats={statsQuery.data}
              operations={operationsQuery.data?.data ?? []}
              roles={rolesQuery.data?.data ?? []}
              actors={actorsQuery.data?.data ?? []}
              isLoading={
                isSummaryView &&
                (statsQuery.isLoading ||
                  operationsQuery.isLoading ||
                  rolesQuery.isLoading ||
                  actorsQuery.isLoading)
              }
              hasError={Boolean(statsQuery.error)}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

function toWorkspaceItems(workspaces: DashboardWorkspaceRecord[]): ComboboxItem[] {
  return workspaces.map((workspace) => ({
    id: workspace.id,
    label: workspace.name,
  }));
}

function toWorkflowItems(workflows: DashboardWorkflowRecord[]): ComboboxItem[] {
  return workflows.map((workflow) => ({
    id: workflow.id,
    label: workflow.name ?? workflow.id,
    subtitle: workflow.workspace?.name ?? undefined,
    status: normalizeEntityStatus(workflow.state ?? workflow.status),
  }));
}

function toTaskItems(tasks: DashboardTaskRecord[]): ComboboxItem[] {
  return tasks.map((task) => ({
    id: task.id,
    label: task.title ?? task.description ?? task.id,
    subtitle: task.role ?? undefined,
    status: normalizeEntityStatus(task.state ?? task.status),
  }));
}

function normalizeEntityStatus(status?: string | null): ComboboxItem['status'] {
  if (!status) {
    return undefined;
  }
  const normalized = status.toLowerCase();
  if (normalized === 'active' || normalized === 'in_progress') {
    return 'active';
  }
  if (normalized === 'completed' || normalized === 'succeeded') {
    return 'completed';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'failed';
  }
  return 'pending';
}

function extractList<T>(response: unknown): T[] {
  if (!response || typeof response !== 'object') {
    return [];
  }
  if (Array.isArray(response)) {
    return response as T[];
  }
  const record = response as Record<string, unknown>;
  return Array.isArray(record.data) ? (record.data as T[]) : [];
}
