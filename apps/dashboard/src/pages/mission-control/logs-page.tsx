import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  dashboardApi,
  type LogEntry,
  type LogQueryResponse,
} from '../../lib/api.js';
import { ExecutionInspectorFilterBar } from '../../components/execution-inspector-filter-bar.js';
import { ExecutionInspectorSummaryView } from '../../components/execution-inspector-summary-view.js';
import { ExecutionInspectorDetailView } from '../../components/execution-inspector-detail-view.js';
import { ExecutionInspectorDebugView } from '../../components/execution-inspector-debug-view.js';
import { WorkflowBudgetCard } from '../../components/workflow-budget-card.js';
import {
  buildLogFilters,
  DEFAULT_INSPECTOR_FILTERS,
  readInspectorFilters,
  readInspectorView,
  readSelectedInspectorLogId,
  writeInspectorFilters,
  type InspectorFilters,
} from '../../components/execution-inspector-support.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';

const PAGE_SIZE = '50';
const SUMMARY_DETAIL_MODE = 'summary';

interface LogsPageProps {
  scopedWorkflowId?: string;
}

export function LogsPage(): JSX.Element {
  return <LogsSurface />;
}

export function LogsSurface(props: LogsPageProps = {}): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [cursor, setCursor] = useState<string | null>(null);
  const [pagedEntries, setPagedEntries] = useState<LogEntry[]>([]);
  const scopedWorkflowId = props.scopedWorkflowId?.trim() ?? '';
  const filters = useMemo(() => {
    const nextFilters = readInspectorFilters(searchParams);
    if (scopedWorkflowId) {
      nextFilters.workflowId = scopedWorkflowId;
    }
    return nextFilters;
  }, [scopedWorkflowId, searchParams]);
  const selectedLogId = useMemo(
    () => readSelectedInspectorLogId(searchParams),
    [searchParams],
  );
  const selectedView = useMemo(() => readInspectorView(searchParams), [searchParams]);
  const filterStateKey = useMemo(() => JSON.stringify(filters), [filters]);

  const baseFilters = useMemo(() => buildLogFilters(filters), [filters]);
  const queryFilters = useMemo(
    () => ({
      ...baseFilters,
      detail: SUMMARY_DETAIL_MODE,
      per_page: PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    }),
    [baseFilters, cursor],
  );

  const logsQuery = useQuery<LogQueryResponse>({
    queryKey: ['execution-inspector', 'logs', queryFilters],
    queryFn: () => dashboardApi.queryLogs(queryFilters),
    refetchInterval: 5_000,
  });
  const statsQuery = useQuery({
    queryKey: ['execution-inspector', 'stats', baseFilters],
    queryFn: () => dashboardApi.getLogStats({ ...baseFilters, group_by: 'category' }),
    refetchInterval: 10_000,
  });
  const budgetQuery = useQuery({
    queryKey: ['workflow-budget', scopedWorkflowId],
    queryFn: () => dashboardApi.getWorkflowBudget(scopedWorkflowId),
    enabled: scopedWorkflowId.length > 0,
    refetchInterval: 10_000,
  });
  const operationsQuery = useQuery({
    queryKey: ['execution-inspector', 'operations', baseFilters.since, baseFilters.until],
    queryFn: () =>
      dashboardApi.getLogOperations({
        since: baseFilters.since,
        category: 'agent_loop,tool,llm,task_lifecycle,container',
      }),
  });
  const rolesQuery = useQuery({
    queryKey: ['execution-inspector', 'roles', baseFilters],
    queryFn: () => dashboardApi.getLogRoles(baseFilters),
  });
  const actorsQuery = useQuery({
    queryKey: ['execution-inspector', 'actors', baseFilters],
    queryFn: () => dashboardApi.getLogActors(baseFilters),
  });

  useEffect(() => {
    setCursor(null);
    setPagedEntries([]);
  }, [filterStateKey]);

  useEffect(() => {
    if (!logsQuery.data) {
      return;
    }
    if (!cursor) {
      setPagedEntries(logsQuery.data.data);
      return;
    }
    setPagedEntries((current) => {
      const seen = new Set(current.map((entry) => entry.id));
      const next = [...current];
      for (const entry of logsQuery.data?.data ?? []) {
        if (!seen.has(entry.id)) {
          next.push(entry);
        }
      }
      return next;
    });
  }, [logsQuery.data, cursor]);

  const entries = pagedEntries;
  const effectiveSelectedLogId = selectedLogId ?? entries[0]?.id ?? null;
  const selectedEntrySummary =
    entries.find((entry) => entry.id === effectiveSelectedLogId) ?? null;
  const selectedEntryQuery = useQuery({
    queryKey: ['execution-inspector', 'log', effectiveSelectedLogId],
    queryFn: () => dashboardApi.getLog(effectiveSelectedLogId ?? ''),
    enabled: effectiveSelectedLogId !== null,
    staleTime: 30_000,
  });
  const selectedEntry =
    selectedEntryQuery.data?.data ?? selectedEntrySummary ?? null;
  const isSelectedOutsideSegment = Boolean(
    effectiveSelectedLogId !== null &&
      selectedEntryQuery.data?.data &&
      !selectedEntrySummary,
  );

  function updateFilters(nextFilters: InspectorFilters): void {
    setSearchParams((current) => {
      const next = writeInspectorFilters(current, {
        ...nextFilters,
        workflowId: scopedWorkflowId || nextFilters.workflowId,
      });
      if (scopedWorkflowId) {
        next.delete('workflow');
      }
      return next;
    }, {
      replace: true,
    });
  }

  function updateSelection(logId: number | null): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (logId === null) {
          next.delete('log');
        } else {
          next.set('log', String(logId));
        }
        return next;
      },
      { replace: true },
    );
  }

  function updateView(view: 'summary' | 'detailed' | 'debug'): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (view === 'summary') {
          next.delete('view');
        } else {
          next.set('view', view);
        }
        return next;
      },
      { replace: true },
    );
  }

  const selectedEntryPermalink = selectedEntry
    ? buildInspectorPermalink(searchParams, selectedEntry.id, selectedView)
    : null;
  const workflowContextLink = selectedEntry?.workflow_id
    ? buildWorkflowContextLink(selectedEntry)
    : null;
  const taskRecordLink = selectedEntry?.task_id
    ? `/work/tasks/${selectedEntry.task_id}`
    : null;

  async function handleExport(): Promise<void> {
    const blob = await dashboardApi.exportLogs(baseFilters);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'execution-inspector.jsonl';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div data-testid="execution-inspector-surface" className="flex flex-col gap-6 p-6">
      <section className="flex flex-col gap-3 rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Execution Inspector</h1>
          <p className="text-sm text-muted">
            Summary, delivery, and debug views over work-item, stage, gate, runtime, and platform execution traces.
          </p>
          {scopedWorkflowId ? (
            <div className="text-sm">
              <Link className="underline-offset-4 hover:underline" to={`/work/workflows/${scopedWorkflowId}`}>
                Back to Workflow Board
              </Link>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void handleExport()}>
            <Download className="h-4 w-4" />
            Export
          </Button>
          {workflowContextLink ? (
            <Button variant="outline" asChild>
              <Link to={workflowContextLink}>Board context</Link>
            </Button>
          ) : null}
          {taskRecordLink ? (
            <Button variant="outline" asChild>
              <Link to={taskRecordLink}>Task record</Link>
            </Button>
          ) : null}
          {selectedEntryPermalink ? (
            <Button variant="outline" asChild>
              <a href={selectedEntryPermalink}>Permalink</a>
            </Button>
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

      <section className="rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
        <ExecutionInspectorFilterBar
          filters={filters}
          operationOptions={(operationsQuery.data?.data ?? []).map((item) => ({
            value: item.operation,
            label: item.operation,
          }))}
          roleOptions={(rolesQuery.data?.data ?? []).map((item) => ({
            value: item.role,
            label: item.role,
          }))}
          actorOptions={(actorsQuery.data?.data ?? []).map((item) => ({
            value: item.actor_id,
            label: item.actor_name || `${item.actor_type}:${item.actor_id}`,
          }))}
          onChange={(next) => {
            updateFilters(next);
            updateSelection(null);
          }}
          onReset={() => {
            updateFilters(DEFAULT_INSPECTOR_FILTERS);
            updateSelection(null);
          }}
        />
      </section>

      <Tabs value={selectedView} onValueChange={(value) => updateView(value as 'summary' | 'detailed' | 'debug')} className="space-y-4">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="detailed">Delivery</TabsTrigger>
          <TabsTrigger value="debug">Debug</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <ExecutionInspectorSummaryView
            stats={statsQuery.data}
            operations={operationsQuery.data?.data ?? []}
            roles={rolesQuery.data?.data ?? []}
            actors={actorsQuery.data?.data ?? []}
            isLoading={
              statsQuery.isLoading ||
              operationsQuery.isLoading ||
              rolesQuery.isLoading ||
              actorsQuery.isLoading
            }
          />
        </TabsContent>

        <TabsContent value="detailed" className="space-y-4">
          {logsQuery.error ? (
            <Card>
              <CardContent className="p-5 text-sm text-red-600">
                Failed to load delivery entries. Please refine filters and try again.
              </CardContent>
            </Card>
          ) : null}
          <ExecutionInspectorDetailView
            entries={entries}
            selectedLogId={effectiveSelectedLogId}
            isLoading={logsQuery.isLoading}
            hasMore={Boolean(logsQuery.data?.pagination.has_more && logsQuery.data.pagination.next_cursor)}
            loadedCount={entries.length}
            isSelectedOutsideSegment={isSelectedOutsideSegment}
            onSelect={updateSelection}
            onLoadMore={() => setCursor(logsQuery.data?.pagination.next_cursor ?? null)}
            onClearSelection={() => updateSelection(null)}
          />
        </TabsContent>

        <TabsContent value="debug">
          {selectedEntryQuery.isLoading && !selectedEntrySummary ? (
            <Card>
              <CardContent className="p-5 text-sm text-muted">
                Loading selected trace detail…
              </CardContent>
            </Card>
          ) : null}
          <ExecutionInspectorDebugView entry={selectedEntry as LogEntry | null} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function buildInspectorPermalink(
  searchParams: URLSearchParams,
  logId: number,
  view: 'summary' | 'detailed' | 'debug',
): string {
  const next = new URLSearchParams(searchParams);
  next.set('log', String(logId));
  if (view === 'summary') {
    next.set('view', 'detailed');
  } else {
    next.set('view', view);
  }
  return `/logs?${next.toString()}`;
}

function buildWorkflowContextLink(entry: LogEntry): string {
  const next = new URLSearchParams();
  if (entry.work_item_id) {
    next.set('work_item', entry.work_item_id);
  }
  if (entry.activation_id) {
    next.set('activation', entry.activation_id);
  }
  if (entry.stage_name && !entry.work_item_id && !entry.activation_id) {
    next.set('stage', entry.stage_name);
  }
  const query = next.toString();
  return query
    ? `/work/workflows/${entry.workflow_id}?${query}`
    : `/work/workflows/${entry.workflow_id}`;
}
