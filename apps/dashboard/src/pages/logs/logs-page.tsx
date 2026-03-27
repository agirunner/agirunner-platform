import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import { dashboardApi } from '../../lib/api.js';
import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
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
import { buildWorkflowDetailPermalink } from '../workflow-detail/workflow-detail-permalinks.js';
import { readLogsSurfaceView } from './logs-page-view.js';

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
    enabled: selectedView === 'summary',
    staleTime: 300_000,
  });
  const rolesQuery = useQuery({
    queryKey: ['operator-log', 'roles', filters, logScope],
    queryFn: () => dashboardApi.getLogRoles(roleOptionFilters),
    enabled: selectedView === 'summary',
    staleTime: 300_000,
  });
  const actorsQuery = useQuery({
    queryKey: ['operator-log', 'actors', filters, logScope],
    queryFn: () => dashboardApi.getLogActors(actorOptionFilters),
    enabled: selectedView === 'summary',
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
        {scopedWorkflowId ? (
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Live Logs</h1>
            <p className="text-sm text-muted">
              {rawFirstSurface
                ? 'Raw logs stay visible as the source of truth. Activity Summary highlights the current filtered results without leaving the stream.'
                : 'Browse raw logs and a single activity summary view without leaving the workflow inspector.'}
            </p>
            <div className="text-sm">
              <Link
                className="underline-offset-4 hover:underline"
                to={buildWorkflowDetailPermalink(scopedWorkflowId, {})}
              >
                Back to Workflow
              </Link>
            </div>
          </div>
        ) : (
          <DashboardPageHeader
            navHref="/diagnostics/live-logs"
            description={
              rawFirstSurface
                ? 'Raw logs stay visible as the source of truth. Activity Summary highlights the current filtered results without leaving the stream.'
                : 'Browse raw logs and a single activity summary view without leaving the workflow inspector.'
            }
          />
        )}
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

      <DashboardSectionCard
        title="Log Views"
        description="Switch between raw stream inspection and the filtered activity summary without leaving the current surface."
      >
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
      </DashboardSectionCard>
    </div>
  );
}
