import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  dashboardApi,
  type LogEntry,
  type LogQueryResponse,
} from '../../../lib/api.js';
import { ExecutionInspectorFilterBar } from '../../../components/execution-inspector-filter-bar.js';
import { ExecutionInspectorSummaryView } from '../../../components/execution-inspector-summary-view.js';
import { ExecutionInspectorDetailView } from '../../../components/execution-inspector-detail-view.js';
import { ExecutionInspectorDebugView } from '../../../components/execution-inspector-debug-view.js';
import { WorkflowBudgetCard } from '../../../components/workflow-budget-card.js';
import {
  buildLogFilters,
  DEFAULT_INSPECTOR_FILTERS,
  describeExecutionOperationOption,
  type InspectorView,
  readInspectorFilters,
  readInspectorView,
  readSelectedInspectorLogId,
  writeInspectorFilters,
  type InspectorFilters,
} from '../../../components/execution-inspector-support.js';
import { LogViewer } from '../../../components/log-viewer/log-viewer.js';
import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs.js';
import { LogsPageActivityPackets } from './logs-page-activity-packets.js';
import {
  buildLogWorkflowContextLink,
  buildInspectorOverviewCards,
  buildRecentLogActivityPackets,
} from './logs-page-support.js';
import { readLogsSurfaceView } from './logs-page-view.js';

const PAGE_SIZE = '50';
const SUMMARY_DETAIL_MODE = 'summary';

interface LogsPageProps {
  scopedWorkflowId?: string;
  mode?: 'logs' | 'inspector';
}

export function LogsPage(): JSX.Element {
  return <LogsSurface mode="logs" />;
}

export function LogsSurface(props: LogsPageProps = {}): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [cursor, setCursor] = useState<string | null>(null);
  const [pagedEntries, setPagedEntries] = useState<LogEntry[]>([]);
  const scopedWorkflowId = props.scopedWorkflowId?.trim() ?? '';
  const surfaceMode = props.mode ?? (scopedWorkflowId ? 'inspector' : 'logs');
  const rawFirstSurface = surfaceMode === 'logs';
  const [logsSurfaceView, setLogsSurfaceView] = useState<InspectorView>(() =>
    rawFirstSurface ? readLogsSurfaceView(searchParams) : 'raw',
  );
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
  const inspectorView = useMemo(() => readInspectorView(searchParams), [searchParams]);
  const selectedView = rawFirstSurface ? logsSurfaceView : inspectorView;
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
    queryKey: ['operator-log', 'logs', queryFilters],
    queryFn: () => dashboardApi.queryLogs(queryFilters),
    refetchInterval: 5_000,
  });
  const statsQuery = useQuery({
    queryKey: ['operator-log', 'stats', baseFilters],
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
    queryKey: ['operator-log', 'operations', baseFilters.since, baseFilters.until],
    queryFn: () =>
      dashboardApi.getLogOperations({
        since: baseFilters.since,
        category: 'agent_loop,tool,llm,task_lifecycle,container',
      }),
  });
  const rolesQuery = useQuery({
    queryKey: ['operator-log', 'roles', baseFilters],
    queryFn: () => dashboardApi.getLogRoles(baseFilters),
  });
  const actorsQuery = useQuery({
    queryKey: ['operator-log', 'actors', baseFilters],
    queryFn: () => dashboardApi.getLogActors(baseFilters),
  });

  useEffect(() => {
    setCursor(null);
    setPagedEntries([]);
  }, [filterStateKey]);

  useEffect(() => {
    if (!rawFirstSurface) {
      return;
    }
    setLogsSurfaceView(readLogsSurfaceView(searchParams));
  }, [rawFirstSurface, searchParams]);

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
    queryKey: ['operator-log', 'log', effectiveSelectedLogId],
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

  function updateView(view: InspectorView): void {
    if (rawFirstSurface) {
      setLogsSurfaceView(view);
    }
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (view === 'raw') {
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
  const overviewCards = useMemo(
    () =>
      buildInspectorOverviewCards(
        filters,
        scopedWorkflowId,
        statsQuery.data,
        operationsQuery.data?.data ?? [],
      ),
    [filters, scopedWorkflowId, statsQuery.data, operationsQuery.data],
  );
  const recentActivityPackets = useMemo(
    () => buildRecentLogActivityPackets(entries),
    [entries],
  );
  const tabLabels = describeLogTab(selectedView, rawFirstSurface);
  const tabFacts = buildTabFacts({
    selectedView,
    rawFirstSurface,
    scopedWorkflowId,
    visibleEntryCount: entries.length,
    hasMoreEntries: Boolean(
      logsQuery.data?.pagination.has_more && logsQuery.data.pagination.next_cursor,
    ),
    selectedEntry,
    packetCount: recentActivityPackets.length,
  });

  async function handleExport(): Promise<void> {
    const blob = await dashboardApi.exportLogs(baseFilters);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'operator-log.jsonl';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div data-testid="operator-log-surface" className="flex flex-col gap-6 p-4 sm:p-6">
      <section className="grid gap-4 rounded-3xl border border-border/70 bg-card/80 p-5 shadow-sm sm:p-6">
        <div className="grid gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Operator Log</h1>
            <p className="text-sm text-muted">
              {rawFirstSurface
                ? 'Raw logs and events are always visible. Use the summary, delivery, and trace tabs for curated views when you need them.'
                : 'Browse execution traces with summary, delivery, and debug views. Raw logs stay accessible in the first tab.'}
            </p>
            {scopedWorkflowId ? (
              <div className="text-sm">
                <Link className="underline-offset-4 hover:underline" to={`/work/boards/${scopedWorkflowId}`}>
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
            {selectedView !== 'raw' && workflowContextLink ? (
              <Button variant="outline" asChild>
                <Link to={workflowContextLink}>Board context</Link>
              </Button>
            ) : null}
            {selectedView !== 'raw' && taskRecordLink ? (
              <Button variant="outline" asChild>
                <Link to={taskRecordLink}>Step record</Link>
              </Button>
            ) : null}
            {selectedView !== 'raw' && selectedEntryPermalink ? (
              <Button variant="outline" asChild>
                <a href={selectedEntryPermalink}>Permalink</a>
              </Button>
            ) : null}
          </div>
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
            <TabsTrigger value="detailed" className="h-auto min-h-11 px-3 py-2">
              <span className="sm:hidden">Delivery</span>
              <span className="hidden sm:inline">{rawFirstSurface ? 'Delivery Packets' : 'Delivery'}</span>
            </TabsTrigger>
            <TabsTrigger value="debug" className="h-auto min-h-11 px-3 py-2">
              <span className="sm:hidden">Trace</span>
              <span className="hidden sm:inline">{rawFirstSurface ? 'Trace Detail' : 'Debug'}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="raw" id="operator-log-raw-stream" className="space-y-4">
          <LogsSurfacePanel
            eyebrow={tabLabels.eyebrow}
            title={tabLabels.title}
            description={tabLabels.description}
            facts={tabFacts}
          />
          <LogViewer compact scope={scopedWorkflowId ? { workflowId: scopedWorkflowId } : undefined} />
        </TabsContent>

        <TabsContent value="summary" id="operator-log-summary" className="space-y-4">
          <LogsSurfacePanel
            eyebrow={tabLabels.eyebrow}
            title={tabLabels.title}
            description={tabLabels.description}
            facts={tabFacts}
          />
          <InspectorFiltersCard
            filters={filters}
            operations={operationsQuery.data?.data ?? []}
            roles={rolesQuery.data?.data ?? []}
            actors={actorsQuery.data?.data ?? []}
            onChange={(next) => {
              updateFilters(next);
              updateSelection(null);
            }}
            onReset={() => {
              updateFilters(DEFAULT_INSPECTOR_FILTERS);
              updateSelection(null);
            }}
          />
          <section className="grid gap-4 md:grid-cols-3">
            {overviewCards.map((card) => (
              <Card key={card.title} className="border-border/70 bg-card/75 shadow-sm">
                <CardContent className="space-y-2 p-5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">
                    {card.title}
                  </p>
                  <p className="text-xl font-semibold tracking-tight">{card.value}</p>
                  <p className="text-sm leading-6 text-muted">{card.detail}</p>
                </CardContent>
              </Card>
            ))}
          </section>
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
            hasError={Boolean(statsQuery.error)}
          />
          <section id="operator-log-activity-packets">
            <LogsPageActivityPackets
              packets={recentActivityPackets}
              onOpenTrace={(logId) => {
                updateSelection(logId);
                updateView('detailed');
              }}
            />
          </section>
        </TabsContent>

        <TabsContent value="detailed" id="operator-log-delivery" className="space-y-4">
          <LogsSurfacePanel
            eyebrow={tabLabels.eyebrow}
            title={tabLabels.title}
            description={tabLabels.description}
            facts={tabFacts}
          />
          <InspectorFiltersCard
            filters={filters}
            operations={operationsQuery.data?.data ?? []}
            roles={rolesQuery.data?.data ?? []}
            actors={actorsQuery.data?.data ?? []}
            onChange={(next) => {
              updateFilters(next);
              updateSelection(null);
            }}
            onReset={() => {
              updateFilters(DEFAULT_INSPECTOR_FILTERS);
              updateSelection(null);
            }}
          />
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

        <TabsContent value="debug" id="operator-log-trace-detail" className="space-y-4">
          <LogsSurfacePanel
            eyebrow={tabLabels.eyebrow}
            title={tabLabels.title}
            description={tabLabels.description}
            facts={tabFacts}
          />
          <InspectorFiltersCard
            filters={filters}
            operations={operationsQuery.data?.data ?? []}
            roles={rolesQuery.data?.data ?? []}
            actors={actorsQuery.data?.data ?? []}
            onChange={(next) => {
              updateFilters(next);
              updateSelection(null);
            }}
            onReset={() => {
              updateFilters(DEFAULT_INSPECTOR_FILTERS);
              updateSelection(null);
            }}
          />
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
  view: InspectorView,
): string {
  const next = new URLSearchParams(searchParams);
  next.set('log', String(logId));
  if (view === 'raw' || view === 'summary') {
    next.set('view', 'detailed');
  } else {
    next.set('view', view);
  }
  return `/logs?${next.toString()}`;
}

function buildWorkflowContextLink(entry: LogEntry): string {
  return buildLogWorkflowContextLink(entry) ?? `/work/boards/${entry.workflow_id}`;
}

function InspectorFiltersCard(props: {
  filters: InspectorFilters;
  operations: Array<{ operation: string }>;
  roles: Array<{ role: string }>;
  actors: Array<{ actor_id: string; actor_name: string | null; actor_type: string }>;
  onChange(next: InspectorFilters): void;
  onReset(): void;
}): JSX.Element {
  return (
    <section className="rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
      <ExecutionInspectorFilterBar
        filters={props.filters}
        operationOptions={props.operations.map((item) => ({
          value: item.operation,
          label: describeExecutionOperationOption(item.operation),
        }))}
        roleOptions={props.roles.map((item) => ({
          value: item.role,
          label: item.role,
        }))}
        actorOptions={props.actors.map((item) => ({
          value: item.actor_id,
          label: item.actor_name || `${item.actor_type}:${item.actor_id}`,
        }))}
        onChange={props.onChange}
        onReset={props.onReset}
      />
    </section>
  );
}

function LogsSurfacePanel(props: {
  eyebrow: string;
  title: string;
  description: string;
  facts: Array<{ label: string; value: string }>;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Badge variant="outline">{props.eyebrow}</Badge>
            <div className="space-y-1">
              <CardTitle>{props.title}</CardTitle>
              <p className="max-w-3xl text-sm leading-6 text-muted">{props.description}</p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {props.facts.map((fact) => (
          <SurfaceFact key={`${fact.label}:${fact.value}`} label={fact.label} value={fact.value} />
        ))}
      </CardContent>
    </Card>
  );
}

function SurfaceFact(props: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-card/80 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        {props.label}
      </div>
      <div className="mt-2 text-sm font-medium text-foreground">{props.value}</div>
    </div>
  );
}

function describeLogTab(view: InspectorView, rawFirstSurface: boolean): {
  eyebrow: string;
  title: string;
  description: string;
} {
  if (view === 'raw') {
    return {
      eyebrow: rawFirstSurface ? 'Raw log truth' : 'Inspector baseline',
      title: rawFirstSurface ? 'Log stream' : 'Raw logs',
      description:
        'Stay here when you need the chronological source-of-truth stream. Expand a row for the full payload and recorded context, then move into summary, delivery, or trace only when you need a curated operator view.',
    };
  }
  if (view === 'summary') {
    return {
      eyebrow: 'Curated summary',
      title: rawFirstSurface ? 'Activity summary' : 'Summary',
      description:
        'Use this lane to understand where attention is clustering before drilling into a single packet. The cards and packets below should explain the current slice without replacing the raw events.',
    };
  }
  if (view === 'detailed') {
    return {
      eyebrow: 'Action queue',
      title: rawFirstSurface ? 'Delivery packets' : 'Delivery',
      description:
        'This list is for picking the next packet to inspect. Select the row that best represents the incident or delivery you are following, then open trace detail for the full payload.',
    };
  }
  return {
    eyebrow: 'Trace diagnostics',
    title: rawFirstSurface ? 'Trace detail' : 'Debug',
    description:
      'Trace detail is for the selected packet only. Use it when the summary is no longer enough and you need recorded payloads, error structure, and diagnostic handles for one execution slice.',
  };
}

function buildTabFacts(input: {
  selectedView: InspectorView;
  rawFirstSurface: boolean;
  scopedWorkflowId: string;
  visibleEntryCount: number;
  hasMoreEntries: boolean;
  selectedEntry: LogEntry | null;
  packetCount: number;
}): Array<{ label: string; value: string }> {
  const scope = input.scopedWorkflowId
    ? `Board ${input.scopedWorkflowId.slice(0, 8)}`
    : 'Cross-workflow execution';

  if (input.selectedView === 'raw') {
    return [
      { label: 'Scope', value: scope },
      { label: 'Visible entries', value: String(input.visibleEntryCount) },
      {
        label: 'Slice status',
        value: input.hasMoreEntries ? 'More history available' : 'Current slice loaded',
      },
      {
        label: 'Path',
        value: input.rawFirstSurface ? 'Raw-first operator surface' : 'Inspector baseline',
      },
    ];
  }

  if (input.selectedView === 'summary') {
    return [
      { label: 'Scope', value: scope },
      { label: 'Recent packets', value: String(input.packetCount) },
      { label: 'Visible entries', value: String(input.visibleEntryCount) },
      { label: 'Operator path', value: 'Review cards, then open one packet' },
    ];
  }

  if (input.selectedView === 'detailed') {
    return [
      { label: 'Scope', value: scope },
      { label: 'Visible packets', value: String(input.visibleEntryCount) },
      {
        label: 'Selected packet',
        value: input.selectedEntry ? `#${input.selectedEntry.id}` : 'Choose from the list',
      },
      {
        label: 'Queue status',
        value: input.hasMoreEntries ? 'More packets available' : 'Current segment fully loaded',
      },
    ];
  }

  return [
    { label: 'Scope', value: scope },
    {
      label: 'Selected packet',
      value: input.selectedEntry ? `#${input.selectedEntry.id}` : 'Choose a packet first',
    },
    {
      label: 'Trace handle',
      value: input.selectedEntry ? input.selectedEntry.trace_id : 'Unavailable until selection',
    },
    { label: 'Debug path', value: 'Payload, error detail, and handles' },
  ];
}
