import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Container,
  DollarSign,
  Cpu,
  Server,
  Workflow as WorkflowIcon,
  Search,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import {
  dashboardApi,
  type DashboardApprovalQueueResponse,
  type DashboardEventRecord,
  type DashboardWorkflowBoardResponse,
} from '../../lib/api.js';
import { subscribeToEvents } from '../../lib/sse.js';
import { cn } from '../../lib/utils.js';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { SavedViews, type SavedViewFilters } from '../../components/saved-views.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import { buildWorkflowDetailPermalink } from '../workflow-detail-permalinks.js';
import {
  countBlockedBoardItems,
  countOpenBoardItems,
  describeBoardHeadline,
  describeWorkflowStage,
  isLiveWorkflow,
  resolveBoardPosture,
} from './live-board-support.js';

interface WorkflowRecord {
  id: string;
  name: string;
  playbook_id?: string | null;
  lifecycle?: 'standard' | 'continuous' | null;
  current_stage?: string | null;
  active_stages?: string[];
  work_item_summary?: {
    total_work_items: number;
    open_work_item_count: number;
    completed_work_item_count: number;
    active_stage_count: number;
    awaiting_gate_count: number;
    active_stage_names: string[];
  } | null;
  state?: string;
  status?: string;
  task_counts?: Record<string, number>;
  metrics?: { total_cost_usd?: number };
  created_at?: string;
  started_at?: string;
}

interface TaskRecord {
  id: string;
  title?: string;
  name?: string;
  status: string;
  state?: string;
  output?: unknown;
  assigned_worker?: string | null;
  workflow_id?: string;
  work_item_id?: string | null;
  stage_name?: string | null;
  role?: string | null;
  retry_count?: number;
  error_message?: string;
  created_at?: string;
}

interface WorkerRecord {
  id: string;
  name?: string;
  status: string;
  current_tasks?: number;
}

interface ThroughputPoint {
  hour: string;
  completed: number;
}

const REFETCH_INTERVAL = 5000;

function normalizeArray<T>(response: unknown): T[] {
  if (Array.isArray(response)) {
    return response as T[];
  }
  const wrapped = response as { data?: unknown } | null;
  if (wrapped && Array.isArray(wrapped.data)) {
    return wrapped.data as T[];
  }
  return [];
}

function buildThroughputData(events: DashboardEventRecord[]): ThroughputPoint[] {
  const now = Date.now();
  const buckets = new Map<string, number>();

  for (let i = 23; i >= 0; i--) {
    const d = new Date(now - i * 3600_000);
    const label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    buckets.set(label, 0);
  }

  for (const event of events) {
    if (event.type !== 'task.completed') {
      continue;
    }
    const ts = new Date(event.created_at).getTime();
    if (now - ts > 24 * 3600_000) {
      continue;
    }
    const label = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (buckets.has(label)) {
      buckets.set(label, (buckets.get(label) ?? 0) + 1);
    }
  }

  return Array.from(buckets.entries()).map(([hour, completed]) => ({ hour, completed }));
}

function statusBadgeVariant(status: string): 'default' | 'success' | 'warning' | 'destructive' | 'secondary' {
  switch (status) {
    case 'in_progress':
    case 'online':
      return 'success';
    case 'awaiting gate':
    case 'awaiting_approval':
    case 'pending':
      return 'warning';
    case 'failed':
    case 'error':
    case 'offline':
      return 'destructive';
    case 'completed':
    case 'done':
      return 'default';
    default:
      return 'secondary';
  }
}

function resolveTaskOperatorState(task: TaskRecord): string {
  return (task.state ?? task.status ?? 'unknown').toLowerCase();
}

function describeAttentionStep(task: TaskRecord): string {
  const state = resolveTaskOperatorState(task);
  if (state === 'awaiting_approval') {
    return 'Step approval';
  }
  if (state === 'output_pending_review') {
    return 'Output gate';
  }
  if (state === 'failed') {
    return 'Execution failure';
  }
  return 'Execution step';
}

export function LiveBoardPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sseEvents, setSseEvents] = useState<DashboardEventRecord[]>([]);
  const searchQuery = searchParams.get('q') ?? '';

  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: () => dashboardApi.listWorkflows(),
    refetchInterval: REFETCH_INTERVAL,
  });

  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: () => dashboardApi.listTasks(),
    refetchInterval: REFETCH_INTERVAL,
  });

  const workersQuery = useQuery({
    queryKey: ['workers'],
    queryFn: () => dashboardApi.listWorkers(),
    refetchInterval: REFETCH_INTERVAL,
  });

  const eventsQuery = useQuery({
    queryKey: ['events-recent'],
    queryFn: () => dashboardApi.listEvents(),
    refetchInterval: REFETCH_INTERVAL,
  });
  const approvalsQuery = useQuery({
    queryKey: ['approval-queue'],
    queryFn: () => dashboardApi.getApprovalQueue() as Promise<DashboardApprovalQueueResponse>,
    refetchInterval: REFETCH_INTERVAL,
  });

  useEffect(() => {
    const unsubscribe = subscribeToEvents((eventType, payload) => {
      const record: DashboardEventRecord = {
        id: String(payload.id ?? Date.now()),
        type: eventType,
        entity_type: payload.entity_type ?? '',
        entity_id: payload.entity_id ?? '',
        actor_type: payload.actor_type ?? 'system',
        actor_id: payload.actor_id ?? null,
        data: payload.data,
        created_at: payload.created_at ?? new Date().toISOString(),
      };
      setSseEvents((prev) => [record, ...prev].slice(0, 50));

      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      queryClient.invalidateQueries({ queryKey: ['approval-queue'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-board'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-stages'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-activations'] });
    });

    return unsubscribe;
  }, [queryClient]);

  const workflows = useMemo(() => normalizeArray<WorkflowRecord>(workflowsQuery.data), [workflowsQuery.data]);
  const tasks = useMemo(() => normalizeArray<TaskRecord>(tasksQuery.data), [tasksQuery.data]);
  const workers = useMemo(() => normalizeArray<WorkerRecord>(workersQuery.data), [workersQuery.data]);
  const apiEvents = useMemo(() => {
    const raw = eventsQuery.data as { data?: DashboardEventRecord[] } | DashboardEventRecord[] | undefined;
    if (Array.isArray(raw)) {
      return raw;
    }
    return raw?.data ?? [];
  }, [eventsQuery.data]);

  const activeWorkflows = useMemo(
    () =>
      workflows.filter((workflow) => {
        if (!isLiveWorkflow(workflow)) {
          return false;
        }
        const normalizedQuery = searchQuery.trim().toLowerCase();
        if (!normalizedQuery) {
          return true;
        }
        const stageTokens =
          workflow.lifecycle === 'continuous'
            ? [
                ...(workflow.active_stages ?? []),
                ...(workflow.work_item_summary?.active_stage_names ?? []),
              ]
            : [
                ...(workflow.active_stages ?? []),
                ...(workflow.work_item_summary?.active_stage_names ?? []),
                workflow.current_stage ?? '',
              ];
        const stageNames = [
          ...stageTokens,
        ]
          .filter((value) => value.trim().length > 0)
          .join(' ')
          .toLowerCase();
        return `${workflow.name} ${workflow.id} ${stageNames}`.toLowerCase().includes(normalizedQuery);
      }),
    [searchQuery, workflows],
  );
  const activePlaybookWorkflows = useMemo(
    () => activeWorkflows.filter((workflow) => workflow.playbook_id).slice(0, 4),
    [activeWorkflows],
  );
  const onlineWorkers = useMemo(() => workers.filter((w) => w.status === 'online' || w.status === 'active'), [workers]);
  const approvalTasks = useMemo(
    () => tasks.filter((task) => resolveTaskOperatorState(task) === 'awaiting_approval'),
    [tasks],
  );
  const failedTasks = useMemo(
    () => tasks.filter((task) => resolveTaskOperatorState(task) === 'failed'),
    [tasks],
  );
  const stageGates = approvalsQuery.data?.stage_gates ?? [];
  const filteredApprovalTasks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return approvalTasks;
    }
    return approvalTasks.filter((task) =>
      `${task.title ?? task.name ?? ''} ${task.id} ${task.workflow_id ?? ''} ${task.work_item_id ?? ''} ${task.stage_name ?? ''} ${task.role ?? ''}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [approvalTasks, searchQuery]);
  const filteredFailedTasks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return failedTasks;
    }
    return failedTasks.filter((task) =>
      `${task.title ?? task.name ?? ''} ${task.id} ${task.workflow_id ?? ''} ${task.work_item_id ?? ''} ${task.stage_name ?? ''} ${task.role ?? ''} ${task.error_message ?? ''}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [failedTasks, searchQuery]);
  const throughputData = useMemo(() => buildThroughputData(apiEvents), [apiEvents]);
  const boardQueries = useQueries({
    queries: activePlaybookWorkflows.map((workflow) => ({
      queryKey: ['workflow-board', workflow.id],
      queryFn: () => dashboardApi.getWorkflowBoard(workflow.id) as Promise<DashboardWorkflowBoardResponse>,
      refetchInterval: REFETCH_INTERVAL,
    })),
  });
  const boardEntries = activePlaybookWorkflows.map((workflow, index) => ({
    workflow,
    board: boardQueries[index]?.data,
    isLoading: Boolean(boardQueries[index]?.isLoading),
    hasError: Boolean(boardQueries[index]?.error),
  }));
  const filteredBoardEntries = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return boardEntries;
    }
    return boardEntries.filter((entry) => {
      const boardContext = entry.board
        ? entry.board.work_items
            .map((item) => `${item.id} ${item.title} ${item.stage_name} ${item.column_id}`)
            .join(' ')
        : '';
      return `${entry.workflow.name} ${entry.workflow.id} ${boardContext}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [boardEntries, searchQuery]);
  const openWorkItems = useMemo(
    () => filteredBoardEntries.reduce((sum, entry) => sum + countOpenBoardItems(entry.board), 0),
    [filteredBoardEntries],
  );
  const blockedItems = useMemo(
    () => filteredBoardEntries.flatMap((entry) => {
      if (!entry.board) {
        return [];
      }
      return entry.board.work_items
        .filter((item) => {
          const column = entry.board?.columns.find((candidate) => candidate.id === item.column_id);
          return Boolean(column?.is_blocked);
        })
        .map((item) => ({
          workflowId: entry.workflow.id,
          workflowName: entry.workflow.name,
          workItemId: item.id,
          title: item.title,
          stageName: item.stage_name,
          columnId: item.column_id,
        }));
    }),
    [filteredBoardEntries],
  );
  const filteredBlockedItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return blockedItems;
    }
    return blockedItems.filter((item) =>
      `${item.workflowName} ${item.workflowId} ${item.workItemId} ${item.stageName} ${item.title}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [blockedItems, searchQuery]);
  const liveStages = useMemo(
    () =>
      new Set(
        activeWorkflows.flatMap((workflow) => {
          const summaryStages = workflow.work_item_summary?.active_stage_names ?? [];
          const activeStages = workflow.active_stages ?? [];
          const liveStageNames = Array.from(new Set([...activeStages, ...summaryStages]));
          if (workflow.lifecycle === 'continuous') {
            return liveStageNames;
          }
          return workflow.current_stage
            ? [workflow.current_stage]
            : liveStageNames;
        }),
      ).size,
    [activeWorkflows],
  );
  const filteredStageGates = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return stageGates;
    }
    return stageGates.filter((gate) =>
      `${gate.workflow_name} ${gate.workflow_id} ${gate.stage_name} ${gate.stage_goal} ${gate.gate_id} ${('request_summary' in gate && typeof gate.request_summary === 'string') ? gate.request_summary : ''} ${gate.recommendation ?? ''}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [searchQuery, stageGates]);
  const savedViewFilters = useMemo<SavedViewFilters>(() => {
    const filters: SavedViewFilters = {};
    if (searchQuery) {
      filters.q = searchQuery;
    }
    return filters;
  }, [searchQuery]);
  const needsAction =
    filteredApprovalTasks.length +
    filteredFailedTasks.length +
    filteredStageGates.length +
    filteredBlockedItems.length;

  const recentEvents = useMemo(() => {
    const merged = [...sseEvents, ...apiEvents];
    const seen = new Set<string>();
    const deduped: DashboardEventRecord[] = [];
    for (const evt of merged) {
      if (!seen.has(evt.id)) {
        seen.add(evt.id);
        deduped.push(evt);
      }
    }
    deduped.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return deduped.slice(0, 10);
  }, [sseEvents, apiEvents]);

  const isLoading = workflowsQuery.isLoading || tasksQuery.isLoading || workersQuery.isLoading;

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const hasError = workflowsQuery.error || tasksQuery.error || workersQuery.error;
  if (hasError) {
    return (
      <div className="p-6 text-red-600">
        <AlertTriangle className="mr-2 inline h-5 w-5" />
        Failed to load dashboard data. Please retry.
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Operator Live Board</h1>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <Input
            value={searchQuery}
            onChange={(event) =>
              setSearchParams(
                event.target.value.trim() ? { q: event.target.value.trim() } : {},
                { replace: true },
              )
            }
            placeholder="Search boards, work items, stages, gates, steps, or IDs"
            className="pl-8"
          />
        </div>
        <SavedViews
          storageKey="live-board"
          currentFilters={savedViewFilters}
          onApply={(filters) =>
            setSearchParams(filters.q ? { q: filters.q } : {}, { replace: true })
          }
        />
      </div>

      <KpiCards
        activeBoards={filteredBoardEntries.length}
        openWorkItems={openWorkItems}
        liveStages={liveStages}
        gateReviews={filteredStageGates.length}
        workersOnline={onlineWorkers.length}
        needsAction={needsAction}
      />

      <NeedsAttentionSection
        approvalTasks={filteredApprovalTasks}
        failedTasks={filteredFailedTasks}
        blockedItems={filteredBlockedItems}
        stageGates={filteredStageGates}
      />

      <ActivePlaybookBoards entries={filteredBoardEntries} />

      <BoardSnapshotTable entries={filteredBoardEntries} />

      <div className="grid gap-6 lg:grid-cols-2">
        <FleetStatusPanel workers={workers} />
        <ThroughputChart data={throughputData} />
      </div>

      <LiveEventStream events={recentEvents} />
    </div>
  );
}

interface KpiCardsProps {
  activeBoards: number;
  openWorkItems: number;
  liveStages: number;
  gateReviews: number;
  workersOnline: number;
  needsAction: number;
}

function KpiCards(props: KpiCardsProps): JSX.Element {
  const cards = [
    { label: 'Live Boards', value: props.activeBoards, icon: WorkflowIcon, color: 'text-blue-600' },
    { label: 'Open Work Items', value: props.openWorkItems, icon: Activity, color: 'text-green-600' },
    { label: 'Live Stages', value: props.liveStages, icon: Cpu, color: 'text-indigo-600' },
    { label: 'Stage Gates', value: props.gateReviews, icon: CheckCircle2, color: 'text-amber-600' },
    { label: 'Workers Online', value: props.workersOnline, icon: Server, color: 'text-indigo-600' },
    { label: 'Containers Running', value: props.workersOnline, icon: Container, color: 'text-purple-600' },
    { label: 'Cost Today', value: '$--', icon: DollarSign, color: 'text-emerald-600' },
    { label: 'Needs Action', value: props.needsAction, icon: AlertTriangle, color: props.needsAction > 0 ? 'text-amber-600' : 'text-muted' },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted">{card.label}</CardTitle>
            <card.icon className={cn('h-4 w-4', card.color)} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

interface NeedsAttentionProps {
  approvalTasks: TaskRecord[];
  failedTasks: TaskRecord[];
  blockedItems: Array<{
    workflowId: string;
    workflowName: string;
    workItemId: string;
    title: string;
    stageName: string;
    columnId: string;
  }>;
  stageGates: DashboardApprovalQueueResponse['stage_gates'];
}

function NeedsAttentionSection({ approvalTasks, failedTasks, blockedItems, stageGates }: NeedsAttentionProps): JSX.Element {
  const items = [...approvalTasks, ...failedTasks];

  if (items.length === 0 && stageGates.length === 0 && blockedItems.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            All Clear
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">No stage gates, blocked work items, or specialist-step interventions require attention right now.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          Operator Queue ({items.length + stageGates.length + blockedItems.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {stageGates.map((gate) => (
            <div key={`${gate.workflow_id}:${gate.stage_name}`} className="flex items-center justify-between rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <Link
                  to={buildWorkflowDetailPermalink(gate.workflow_id, {
                    gateStageName: gate.stage_name,
                  })}
                  className="truncate text-sm font-medium text-accent hover:underline"
                >
                  {gate.workflow_name}
                </Link>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="warning">stage gate</Badge>
                  <span className="text-xs text-muted">{gate.stage_name}</span>
                </div>
                <p className="mt-1 text-xs text-muted">{gate.stage_goal}</p>
              </div>
              <div className="ml-4 shrink-0">
                <Button size="sm" asChild>
                  <Link to={`/work/approvals`}>Open Gate</Link>
                </Button>
              </div>
            </div>
          ))}
          {blockedItems.map((item) => (
            <div key={`${item.workflowId}:${item.title}:${item.stageName}`} className="flex items-center justify-between rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <Link
                  to={buildWorkflowDetailPermalink(item.workflowId, {
                    workItemId: item.workItemId,
                  })}
                  className="truncate text-sm font-medium text-accent hover:underline"
                >
                  {item.workflowName}
                </Link>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="destructive">blocked work item</Badge>
                  <span className="text-xs text-muted">{item.stageName}</span>
                </div>
                <p className="mt-1 truncate text-xs text-muted">{item.title}</p>
              </div>
            </div>
          ))}
          {items.map((task) => (
            <div key={task.id} className="flex items-center justify-between rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">{task.title ?? task.name ?? task.id}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant={resolveTaskOperatorState(task) === 'failed' ? 'destructive' : 'warning'}>
                    {describeAttentionStep(task)}
                  </Badge>
                  {task.stage_name ? <span className="text-xs text-muted">Stage: {task.stage_name}</span> : null}
                  {task.work_item_id ? <span className="text-xs text-muted">Work item: {task.work_item_id}</span> : null}
                  {task.role ? <span className="text-xs text-muted">Role: {task.role}</span> : null}
                  {task.assigned_worker && (
                    <span className="text-xs text-muted">Worker: {task.assigned_worker}</span>
                  )}
                </div>
              </div>
              <div className="ml-4 flex shrink-0 gap-2">
                {resolveTaskOperatorState(task) === 'awaiting_approval' && (
                  <>
                    <Button size="sm" onClick={() => dashboardApi.approveTask(task.id)}>Approve Step</Button>
                    <Button size="sm" variant="outline" onClick={() => dashboardApi.rejectTask(task.id, { feedback: 'Rejected from live board' })}>Reject Step</Button>
                  </>
                )}
                {resolveTaskOperatorState(task) === 'failed' && (
                  <Button size="sm" variant="outline" onClick={() => dashboardApi.retryTask(task.id)}>Retry Step</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BoardSnapshotTable(props: {
  entries: Array<{
    workflow: WorkflowRecord;
    board?: DashboardWorkflowBoardResponse;
    isLoading: boolean;
    hasError: boolean;
  }>;
}): JSX.Element {
  if (props.entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Board Snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">No live boards.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Board Snapshot</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Board</TableHead>
              <TableHead>Posture</TableHead>
              <TableHead>Active Stages</TableHead>
              <TableHead>Open Work</TableHead>
              <TableHead>Blocked</TableHead>
              <TableHead>Gates</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.entries.map(({ workflow, board, isLoading, hasError }) => {
              const posture = resolveBoardPosture(workflow, board);
              return (
                <TableRow key={workflow.id}>
                  <TableCell className="font-medium">
                    <Link className="text-accent hover:underline" to={`/work/workflows/${workflow.id}`}>
                      {workflow.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Badge variant={statusBadgeVariant(posture)}>{posture}</Badge>
                      <p className="text-xs text-muted">{describeBoardHeadline(workflow, board)}</p>
                    </div>
                  </TableCell>
                  <TableCell>{describeWorkflowStage(workflow)}</TableCell>
                  <TableCell>{isLoading ? 'Loading…' : hasError ? 'Unavailable' : countOpenBoardItems(board)}</TableCell>
                  <TableCell>{isLoading ? 'Loading…' : hasError ? 'Unavailable' : countBlockedBoardItems(board)}</TableCell>
                  <TableCell>{workflow.work_item_summary?.awaiting_gate_count ?? 0}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ActivePlaybookBoards(props: {
  entries: Array<{
    workflow: WorkflowRecord;
    board?: DashboardWorkflowBoardResponse;
    isLoading: boolean;
    hasError: boolean;
  }>;
}): JSX.Element {
  if (props.entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Live Boards</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">No live playbook boards.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Boards</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 xl:grid-cols-2">
          {props.entries.map(({ workflow, board, isLoading, hasError }) => {
            const activeItems = board
              ? board.work_items.filter((item) => {
                  const column = board.columns.find((entry) => entry.id === item.column_id);
                  return !column?.is_terminal;
                })
              : [];
            return (
              <div key={workflow.id} className="rounded-md border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link to={`/work/workflows/${workflow.id}`} className="font-medium text-accent hover:underline">
                      {workflow.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {describeWorkflowStage(workflow)}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {describeBoardHeadline(workflow, board)}
                    </p>
                  </div>
                  <Badge variant={statusBadgeVariant(resolveBoardPosture(workflow, board))}>
                    {resolveBoardPosture(workflow, board)}
                  </Badge>
                </div>
                {isLoading ? <p className="mt-3 text-sm text-muted">Loading board...</p> : null}
                {hasError ? <p className="mt-3 text-sm text-red-600">Failed to load board.</p> : null}
                {!isLoading && !hasError ? (
                  <div className="mt-3 space-y-2">
                    {activeItems.slice(0, 6).map((item) => (
                      <div key={item.id} className="rounded-md border border-border/60 bg-muted/10 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <Link
                            to={buildWorkflowDetailPermalink(workflow.id, { workItemId: item.id })}
                            className="truncate text-sm font-medium text-accent hover:underline"
                          >
                            {item.title}
                          </Link>
                          <Badge variant="outline">{item.column_id}</Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                          <span>{item.stage_name}</span>
                          {item.task_count !== undefined ? <span>{item.task_count} specialist steps</span> : null}
                          <span>{item.priority}</span>
                        </div>
                      </div>
                    ))}
                    {activeItems.length === 0 ? (
                      <p className="text-sm text-muted">No active work items outside terminal columns.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

interface FleetStatusPanelProps {
  workers: WorkerRecord[];
}

function FleetStatusPanel({ workers }: FleetStatusPanelProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-4 w-4" />
          Fleet Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        {workers.length === 0 ? (
          <p className="text-sm text-muted">No workers registered.</p>
        ) : (
          <div className="space-y-2">
            {workers.map((w) => (
              <div key={w.id} className="flex items-center justify-between rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-muted" />
                  <span className="text-sm font-medium">{w.name ?? w.id}</span>
                </div>
                <div className="flex items-center gap-2">
                  {w.current_tasks != null && (
                    <span className="text-xs text-muted">{w.current_tasks} steps</span>
                  )}
                  <Badge variant={statusBadgeVariant(w.status)}>{w.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ThroughputChartProps {
  data: ThroughputPoint[];
}

function ThroughputChart({ data }: ThroughputChartProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Specialist Step Throughput (24h)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="throughputGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
            <Tooltip />
            <Area
              type="monotone"
              dataKey="completed"
              stroke="hsl(var(--accent))"
              fill="url(#throughputGrad)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface LiveEventStreamProps {
  events: DashboardEventRecord[];
}

function LiveEventStream({ events }: LiveEventStreamProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Live Event Stream
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted">No recent events.</p>
        ) : (
          <div className="space-y-2">
            {events.map((evt) => (
              <div key={evt.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{evt.type}</Badge>
                  <span className="text-muted">{evt.entity_type}/{evt.entity_id?.slice(0, 8)}</span>
                </div>
                <span className="text-xs text-muted">
                  {new Date(evt.created_at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
