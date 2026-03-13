import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
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
  type DashboardWorkflowActivationRecord,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import { buildWorkflowDetailPermalink } from '../workflow-detail-permalinks.js';
import { buildTimelineContext, describeTimelineEvent } from '../workflow-history-card.js';
import { buildTimelineEntryActions } from '../workflow-history-card.actions.js';
import type { DashboardWorkflowTaskRow } from '../workflow-detail-support.js';
import { buildAttentionTaskActions } from './live-board-attention-actions.js';
import {
  countActiveSpecialistSteps,
  countBlockedBoardItems,
  countFleetAttentionSignals,
  countEscalatedSteps,
  countOpenBoardItems,
  countWorkItemReworks,
  describeBoardHeadline,
  describeBoardProgress,
  describeBoardSpend,
  describeBoardTokens,
  describeFleetAttention,
  describeWorkItemOperatorSummary,
  describeFleetHeadline,
  describeOrchestratorPool,
  describeRiskPosture,
  describeSpecialistPool,
  describeWorkflowStage,
  readBoardProgressPercent,
  describeWorkerCapacity,
  formatRelativeTimestamp,
  isLiveWorkflow,
  resolveBoardPosture,
  summarizeActivationHealth,
  summarizeWorkerFleet,
  summarizeVisibleTokenUsage,
  countReworkHeavySteps,
  countSpecialistReviewQueue,
} from './live-board-support.js';
import {
  buildWorkflowStageProgressSteps,
  describeWorkflowStageLabel,
  describeWorkflowStageProgressSummary,
  describeWorkflowStageSummary,
} from './live-board-stage-presentation.js';

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
  metrics?: {
    total_cost_usd?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
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
  activation_id?: string | null;
  stage_name?: string | null;
  role?: string | null;
  retry_count?: number;
  is_orchestrator_task?: boolean | null;
  error_message?: string;
  created_at?: string;
}

const LIVE_BOARD_PAGE_SIZE = 8;

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
    case 'busy':
      return 'success';
    case 'draining':
    case 'awaiting gate':
    case 'awaiting_approval':
    case 'pending':
      return 'warning';
    case 'failed':
    case 'error':
    case 'degraded':
    case 'disconnected':
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

function countFailedSpecialistSteps(tasks: TaskRecord[]): number {
  return tasks.filter(
    (task) => !task.is_orchestrator_task && resolveTaskOperatorState(task) === 'failed',
  ).length;
}

function summarizeSpecialistPosture(tasks: TaskRecord[]) {
  return {
    active: countActiveSpecialistSteps(tasks),
    reviews: countSpecialistReviewQueue(tasks),
    escalations: countEscalatedSteps(tasks),
    reworkHeavy: countReworkHeavySteps(tasks),
    failed: countFailedSpecialistSteps(tasks),
  };
}

interface LiveBoardEntry {
  workflow: WorkflowRecord;
  board?: DashboardWorkflowBoardResponse;
  activations: DashboardWorkflowActivationRecord[];
  tasks: TaskRecord[];
  gateCount: number;
  isLoading: boolean;
  hasError: boolean;
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
  const stageGates = approvalsQuery.data?.stage_gates ?? [];
  const taskSearchIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const task of tasks) {
      if (!task.workflow_id) {
        continue;
      }
      const existing = index.get(task.workflow_id) ?? '';
      const content = [
        task.title ?? task.name ?? '',
        task.id,
        task.workflow_id,
        task.work_item_id ?? '',
        task.stage_name ?? '',
        task.role ?? '',
        task.error_message ?? '',
      ]
        .join(' ')
        .toLowerCase();
      index.set(task.workflow_id, `${existing} ${content}`.trim());
    }
    return index;
  }, [tasks]);
  const gateSearchIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const gate of stageGates) {
      const existing = index.get(gate.workflow_id) ?? '';
      const content = [
        gate.workflow_name,
        gate.workflow_id,
        gate.stage_name,
        gate.stage_goal,
        gate.gate_id,
        'request_summary' in gate && typeof gate.request_summary === 'string'
          ? gate.request_summary
          : '',
        gate.recommendation ?? '',
      ]
        .join(' ')
        .toLowerCase();
      index.set(gate.workflow_id, `${existing} ${content}`.trim());
    }
    return index;
  }, [stageGates]);
  const tasksByWorkflowId = useMemo(() => {
    const grouped = new Map<string, TaskRecord[]>();
    for (const task of tasks) {
      if (!task.workflow_id) {
        continue;
      }
      const bucket = grouped.get(task.workflow_id) ?? [];
      bucket.push(task);
      grouped.set(task.workflow_id, bucket);
    }
    return grouped;
  }, [tasks]);
  const gateCountByWorkflowId = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const gate of stageGates) {
      grouped.set(gate.workflow_id, (grouped.get(gate.workflow_id) ?? 0) + 1);
    }
    return grouped;
  }, [stageGates]);
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
        const taskTokens = taskSearchIndex.get(workflow.id) ?? '';
        const gateTokens = gateSearchIndex.get(workflow.id) ?? '';
        return `${workflow.name} ${workflow.id} ${stageNames} ${taskTokens} ${gateTokens}`
          .toLowerCase()
          .includes(normalizedQuery);
      }),
    [gateSearchIndex, searchQuery, taskSearchIndex, workflows],
  );
  const activePlaybookWorkflows = useMemo(
    () => activeWorkflows.filter((workflow) => workflow.playbook_id),
    [activeWorkflows],
  );
  const [boardPage, setBoardPage] = useState(0);
  const approvalTasks = useMemo(
    () => tasks.filter((task) => resolveTaskOperatorState(task) === 'awaiting_approval'),
    [tasks],
  );
  const failedTasks = useMemo(
    () => tasks.filter((task) => resolveTaskOperatorState(task) === 'failed'),
    [tasks],
  );
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
  const totalBoardPages = Math.max(1, Math.ceil(activePlaybookWorkflows.length / LIVE_BOARD_PAGE_SIZE));
  const safeBoardPage = Math.min(boardPage, totalBoardPages - 1);
  const pagedPlaybookWorkflows = useMemo(
    () =>
      activePlaybookWorkflows.slice(
        safeBoardPage * LIVE_BOARD_PAGE_SIZE,
        (safeBoardPage + 1) * LIVE_BOARD_PAGE_SIZE,
      ),
    [activePlaybookWorkflows, safeBoardPage],
  );
  useEffect(() => {
    setBoardPage(0);
  }, [searchQuery]);
  const throughputData = useMemo(() => buildThroughputData(apiEvents), [apiEvents]);
  const boardQueries = useQueries({
    queries: pagedPlaybookWorkflows.map((workflow) => ({
      queryKey: ['workflow-board', workflow.id],
      queryFn: () => dashboardApi.getWorkflowBoard(workflow.id) as Promise<DashboardWorkflowBoardResponse>,
      refetchInterval: REFETCH_INTERVAL,
    })),
  });
  const activationQueries = useQueries({
    queries: pagedPlaybookWorkflows.map((workflow) => ({
      queryKey: ['workflow-activations', workflow.id],
      queryFn: () =>
        dashboardApi.listWorkflowActivations(workflow.id) as Promise<DashboardWorkflowActivationRecord[]>,
      refetchInterval: REFETCH_INTERVAL,
    })),
  });
  const boardEntries = pagedPlaybookWorkflows.map<LiveBoardEntry>((workflow, index) => ({
    workflow,
    board: boardQueries[index]?.data,
    activations: normalizeArray<DashboardWorkflowActivationRecord>(activationQueries[index]?.data),
    tasks: tasksByWorkflowId.get(workflow.id) ?? [],
    gateCount: gateCountByWorkflowId.get(workflow.id) ?? 0,
    isLoading: Boolean(boardQueries[index]?.isLoading || activationQueries[index]?.isLoading),
    hasError: Boolean(boardQueries[index]?.error || activationQueries[index]?.error),
  }));
  const visibleTokenPosture = useMemo(
    () => summarizeVisibleTokenUsage(pagedPlaybookWorkflows),
    [pagedPlaybookWorkflows],
  );
  const blockedItems = useMemo(
    () => boardEntries.flatMap((entry) => {
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
    [boardEntries],
  );
  const visibleActivationSummary = useMemo(
    () => summarizeActivationHealth(boardEntries.flatMap((entry) => entry.activations)),
    [boardEntries],
  );
  const visibleWorkflowTasks = useMemo(
    () => boardEntries.flatMap((entry) => entry.tasks),
    [boardEntries],
  );
  const visibleSpecialistSummary = useMemo(
    () => summarizeSpecialistPosture(visibleWorkflowTasks),
    [visibleWorkflowTasks],
  );
  const visibleFailedSteps = visibleSpecialistSummary.failed;
  const visibleBlockedWorkItems = useMemo(
    () => boardEntries.reduce((sum, entry) => sum + countBlockedBoardItems(entry.board), 0),
    [boardEntries],
  );
  const visibleGateReviews = useMemo(
    () => boardEntries.reduce((sum, entry) => sum + entry.gateCount, 0),
    [boardEntries],
  );
  const visibleSpend = useMemo(
    () =>
      pagedPlaybookWorkflows.reduce(
        (sum, workflow) => sum + Number(workflow.metrics?.total_cost_usd ?? 0),
        0,
      ),
    [pagedPlaybookWorkflows],
  );
  const visibleSpentBoards = useMemo(
    () =>
      pagedPlaybookWorkflows.filter(
        (workflow) => Number(workflow.metrics?.total_cost_usd ?? 0) > 0,
      ).length,
    [pagedPlaybookWorkflows],
  );
  const visibleCompletedWorkItems = useMemo(
    () =>
      pagedPlaybookWorkflows.reduce(
        (sum, workflow) => sum + Number(workflow.work_item_summary?.completed_work_item_count ?? 0),
        0,
      ),
    [pagedPlaybookWorkflows],
  );
  const fleetSummary = useMemo(() => summarizeWorkerFleet(workers), [workers]);
  const fleetAttentionCount = countFleetAttentionSignals(fleetSummary);
  const visibleNeedsAttention =
    visibleBlockedWorkItems +
    visibleGateReviews +
    visibleFailedSteps +
    visibleSpecialistSummary.escalations +
    visibleActivationSummary.needsAttention +
    fleetAttentionCount;
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
  const visibleLiveStages = useMemo(
    () =>
      new Set(
        pagedPlaybookWorkflows.flatMap((workflow) => {
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
    [pagedPlaybookWorkflows],
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
  const liveTimelineContext = useMemo(
    () => buildLiveTimelineContext(boardEntries, visibleWorkflowTasks),
    [boardEntries, visibleWorkflowTasks],
  );
  const liveEventWorkflowMaps = useMemo(
    () => buildLiveEventWorkflowMaps(boardEntries, visibleWorkflowTasks),
    [boardEntries, visibleWorkflowTasks],
  );
  const latestActivity = recentEvents[0] ?? null;
  const latestActivityDescriptor = latestActivity
    ? describeTimelineEvent(latestActivity, liveTimelineContext)
    : null;

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
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-2">
          <Badge variant="outline" className="w-fit">
            Mission control
          </Badge>
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">Operator Live Board</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted">
              Triage what needs attention first, then drill into the affected board, work item, or
              review packet with full context.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={visibleSpecialistSummary.escalations > 0 ? 'destructive' : 'outline'}>
            {visibleSpecialistSummary.escalations > 0
              ? `${visibleSpecialistSummary.escalations} escalations`
              : 'No escalations'}
          </Badge>
          <Badge variant={visibleActivationSummary.stale > 0 ? 'warning' : 'outline'}>
            {visibleActivationSummary.stale > 0
              ? `${visibleActivationSummary.stale} stale turns`
              : 'No stale turns'}
          </Badge>
          <Badge variant={visibleGateReviews > 0 ? 'warning' : 'outline'}>
            {visibleGateReviews > 0
              ? `${visibleGateReviews} gate reviews`
              : 'No gate reviews'}
          </Badge>
        </div>
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardContent className="grid gap-4 p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Filter the live operator view</p>
              <p className="text-xs text-muted">
                Showing {activePlaybookWorkflows.length} live boards, {filteredStageGates.length}{' '}
                stage gates, {filteredApprovalTasks.length} approvals, and {filteredFailedTasks.length}{' '}
                failed specialist steps in the current scope.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {searchQuery ? <Badge variant="outline">Search: {searchQuery}</Badge> : null}
              <Badge variant="outline">
                {needsAction > 0 ? `${needsAction} interventions open` : 'No interventions open'}
              </Badge>
            </div>
          </div>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative min-w-0">
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
        </CardContent>
      </Card>

      <KpiCards
        activeBoards={pagedPlaybookWorkflows.length}
        openWorkItems={boardEntries.reduce(
          (sum, entry) => sum + (entry.workflow.work_item_summary?.open_work_item_count ?? 0),
          0,
        )}
        completedWorkItems={visibleCompletedWorkItems}
        liveStages={visibleLiveStages}
        gateReviews={visibleGateReviews}
        blockedWorkItems={visibleBlockedWorkItems}
        failedSteps={visibleFailedSteps}
        staleActivations={visibleActivationSummary.stale}
        escalatedSteps={visibleSpecialistSummary.escalations}
        needsAction={visibleNeedsAttention}
        reportedSpend={visibleSpend}
        spentBoards={visibleSpentBoards}
        tokenPosture={visibleTokenPosture}
        fleetSummary={fleetSummary}
        fleetAttentionCount={fleetAttentionCount}
        latestActivityLabel={latestActivityDescriptor?.emphasisLabel ?? 'No recent activity'}
        latestActivityDetail={
          latestActivityDescriptor
            ? `${formatRelativeTimestamp(latestActivity.created_at)} • ${latestActivityDescriptor.scopeSummary ?? 'Recent operator activity recorded.'}`
            : 'Recent operator activity recorded.'
        }
      />

      <TriagePostureSection
        entries={boardEntries}
        visibleSpend={visibleSpend}
        visibleTokenPosture={visibleTokenPosture}
        visibleActivationSummary={visibleActivationSummary}
        visibleSpecialistSummary={visibleSpecialistSummary}
        visibleBlockedWorkItems={visibleBlockedWorkItems}
        visibleGateReviews={visibleGateReviews}
        visibleFailedSteps={visibleFailedSteps}
        fleetSummary={fleetSummary}
        visibleFleetAttention={fleetAttentionCount}
        visibleNeedsAttention={visibleNeedsAttention}
      />

      <NeedsAttentionSection
        approvalTasks={filteredApprovalTasks}
        failedTasks={filteredFailedTasks}
        blockedItems={filteredBlockedItems}
        stageGates={filteredStageGates}
        fleetSummary={fleetSummary}
      />

      <BoardPaginationCard
        page={safeBoardPage}
        totalPages={totalBoardPages}
        totalBoards={activePlaybookWorkflows.length}
        pageSize={LIVE_BOARD_PAGE_SIZE}
        onPrevious={() => setBoardPage((current) => Math.max(0, current - 1))}
        onNext={() => setBoardPage((current) => current + 1)}
      />

      <ActivePlaybookBoards entries={boardEntries} />

      <BoardSnapshotTable entries={boardEntries} />

      <div className="grid gap-6 lg:grid-cols-2">
        <FleetStatusPanel workers={workers} />
        <ThroughputChart data={throughputData} />
      </div>

      <LiveEventStream
        context={liveTimelineContext}
        events={recentEvents}
        workflowMaps={liveEventWorkflowMaps}
      />
    </div>
  );
}

interface BoardPaginationCardProps {
  page: number;
  totalPages: number;
  totalBoards: number;
  pageSize: number;
  onPrevious(): void;
  onNext(): void;
}

function BoardPaginationCard(props: BoardPaginationCardProps): JSX.Element | null {
  if (props.totalBoards <= props.pageSize) {
    return null;
  }
  const start = props.page * props.pageSize + 1;
  const end = Math.min((props.page + 1) * props.pageSize, props.totalBoards);
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Board Pages</CardTitle>
          <p className="text-sm text-muted">
            Showing {start}-{end} of {props.totalBoards} live boards.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">
            Page {props.page + 1} of {props.totalPages}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={props.page === 0} onClick={props.onPrevious}>
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.page >= props.totalPages - 1}
            onClick={props.onNext}
          >
            Next
          </Button>
        </div>
      </CardHeader>
    </Card>
  );
}

interface KpiCardsProps {
  activeBoards: number;
  openWorkItems: number;
  completedWorkItems: number;
  liveStages: number;
  gateReviews: number;
  blockedWorkItems: number;
  failedSteps: number;
  staleActivations: number;
  escalatedSteps: number;
  needsAction: number;
  reportedSpend: number;
  spentBoards: number;
  tokenPosture: string;
  fleetSummary: ReturnType<typeof summarizeWorkerFleet>;
  fleetAttentionCount: number;
  latestActivityLabel: string;
  latestActivityDetail: string;
}

function KpiCards(props: KpiCardsProps): JSX.Element {
  const attentionDetailParts = [
    props.gateReviews > 0 ? `${props.gateReviews} gates` : null,
    props.blockedWorkItems > 0 ? `${props.blockedWorkItems} blocked` : null,
    props.failedSteps > 0 ? `${props.failedSteps} failed` : null,
    props.escalatedSteps > 0 ? `${props.escalatedSteps} escalated` : null,
    props.staleActivations > 0 ? `${props.staleActivations} stale` : null,
    props.fleetAttentionCount > 0 ? `${props.fleetAttentionCount} fleet` : null,
  ].filter((part): part is string => part !== null);
  const cards = [
    {
      label: 'Visible board scope',
      value: props.activeBoards,
      detail: `${props.liveStages} live stages • ${props.openWorkItems} open work items on this page`,
      icon: WorkflowIcon,
      color: 'text-blue-600',
    },
    {
      label: 'Delivery progress',
      value: props.completedWorkItems > 0 ? `${props.completedWorkItems} complete` : 'No completions',
      detail: `${props.openWorkItems} open work items • ${props.gateReviews} gate reviews waiting`,
      icon: Activity,
      color: 'text-green-600',
    },
    {
      label: 'Attention posture',
      value: props.needsAction > 0 ? `${props.needsAction} open` : 'Stable',
      detail:
        attentionDetailParts.length > 0
          ? attentionDetailParts.join(' • ')
          : 'No gates, blocked work, failed steps, stale turns, or fleet issues on this page',
      icon: AlertTriangle,
      color: props.needsAction > 0 ? 'text-amber-600' : 'text-muted',
    },
    {
      label: 'Spend & token coverage',
      value: props.reportedSpend > 0 ? `$${props.reportedSpend.toFixed(2)}` : 'No spend',
      detail:
        props.spentBoards > 0
          ? `${props.spentBoards} board runs reporting spend • ${props.tokenPosture}`
          : props.tokenPosture,
      icon: DollarSign,
      color: 'text-emerald-600',
    },
    {
      label: 'Worker capacity',
      value: `${props.fleetSummary.online} online`,
      detail: `${props.fleetSummary.busy} busy • ${props.fleetSummary.available} available • ${props.fleetSummary.assignedSteps} assigned`,
      icon: Server,
      color: 'text-indigo-600',
    },
    {
      label: 'Latest operator activity',
      value: props.latestActivityLabel,
      detail: props.latestActivityDetail,
      icon: CheckCircle2,
      color: 'text-sky-600',
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.label} className="border-border/70 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted">{card.label}</CardTitle>
            <card.icon className={cn('h-4 w-4', card.color)} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
            <p className="mt-2 text-xs leading-5 text-muted">{card.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

interface TriagePostureSectionProps {
  entries: LiveBoardEntry[];
  visibleSpend: number;
  visibleTokenPosture: string;
  visibleActivationSummary: ReturnType<typeof summarizeActivationHealth>;
  visibleSpecialistSummary: ReturnType<typeof summarizeSpecialistPosture>;
  visibleBlockedWorkItems: number;
  visibleGateReviews: number;
  visibleFailedSteps: number;
  fleetSummary: ReturnType<typeof summarizeWorkerFleet>;
  visibleFleetAttention: number;
  visibleNeedsAttention: number;
}

function TriagePostureSection(props: TriagePostureSectionProps): JSX.Element {
  const hasBoards = props.entries.length > 0;
  const pageScopeLabel = hasBoards
    ? `${props.entries.length} board${props.entries.length === 1 ? '' : 's'} on the visible page`
    : 'No boards on the current page';
  const riskPosture = describeRiskPosture({
    blocked: props.visibleBlockedWorkItems,
    gates: props.visibleGateReviews,
    failed: props.visibleFailedSteps,
    escalated: props.visibleSpecialistSummary.escalations,
    reworkHeavy: props.visibleSpecialistSummary.reworkHeavy,
    staleActivations: props.visibleActivationSummary.stale,
    fleetIssues: props.visibleFleetAttention,
  });
  const hasLoadingBoards = props.entries.some((entry) => entry.isLoading);
  const hasBoardErrors = props.entries.some((entry) => entry.hasError);

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Visible Board Triage Posture</CardTitle>
            <p className="text-sm text-muted">
              Self-sufficient triage for the current board page: pool posture, stale recovery,
              spend and tokens, and blocked or rework-heavy signals without extra drill-in.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{pageScopeLabel}</Badge>
            <Badge variant={props.visibleNeedsAttention > 0 ? 'warning' : 'success'}>
              {props.visibleNeedsAttention > 0
                ? `${props.visibleNeedsAttention} attention signals`
                : 'Page is stable'}
            </Badge>
          </div>
        </div>
        {hasLoadingBoards ? (
          <p className="text-xs text-muted">Refreshing visible board telemetry…</p>
        ) : null}
        {hasBoardErrors ? (
          <p className="text-xs text-red-600">
            Some activation or board telemetry is temporarily unavailable.
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <TriagePacket
            title="Orchestrator pool posture"
            headline={describeOrchestratorPool(props.visibleActivationSummary)}
            detail={`${props.visibleActivationSummary.queuedEvents} queued event batches, ${props.visibleActivationSummary.stale} stale turns, and ${props.visibleActivationSummary.recovered} recovered turns across visible boards.`}
            chips={[
              `${props.visibleActivationSummary.inFlight} active turns`,
              `${props.visibleActivationSummary.queuedEvents} queued batches`,
              props.visibleActivationSummary.stale > 0
                ? `${props.visibleActivationSummary.stale} stale`
                : 'No stale turns',
              props.visibleActivationSummary.recovered > 0
                ? `${props.visibleActivationSummary.recovered} recovered`
                : 'No recoveries',
            ]}
            emphasis={
              props.visibleActivationSummary.needsAttention > 0 ? 'destructive' : 'neutral'
            }
          />
          <TriagePacket
            title="Specialist pool posture"
            headline={describeSpecialistPool(props.visibleSpecialistSummary)}
            detail={`${props.visibleSpecialistSummary.active} active specialist steps and ${props.visibleSpecialistSummary.reviews} review packets currently visible.`}
            chips={[
              `${props.visibleSpecialistSummary.active} active`,
              `${props.visibleSpecialistSummary.reviews} reviews`,
              props.visibleSpecialistSummary.escalations > 0
                ? `${props.visibleSpecialistSummary.escalations} escalated`
                : 'No escalations',
              props.visibleSpecialistSummary.reworkHeavy > 0
                ? `${props.visibleSpecialistSummary.reworkHeavy} rework-heavy`
                : 'No rework hotspots',
            ]}
            emphasis={
              props.visibleSpecialistSummary.escalations > 0 ||
              props.visibleSpecialistSummary.reworkHeavy > 0
                ? 'warning'
                : 'neutral'
            }
          />
          <TriagePacket
            title="Escalation and stale attention"
            headline={riskPosture}
            detail={`${props.visibleGateReviews} gates, ${props.visibleBlockedWorkItems} blocked items, ${props.visibleFailedSteps} failed specialist steps, ${props.visibleActivationSummary.stale} stale orchestrator turns, and ${describeFleetAttention(props.fleetSummary).toLowerCase()} in scope.`}
            chips={[
              `${props.visibleGateReviews} gates`,
              `${props.visibleBlockedWorkItems} blocked`,
              `${props.visibleFailedSteps} failed`,
              `${props.visibleSpecialistSummary.escalations} escalated`,
              `${props.visibleActivationSummary.stale} stale`,
              props.visibleFleetAttention > 0 ? `${props.visibleFleetAttention} fleet` : 'Fleet stable',
            ]}
            emphasis={props.visibleNeedsAttention > 0 ? 'destructive' : 'neutral'}
          />
          <TriagePacket
            title="Spend and token posture"
            headline={props.visibleSpend > 0 ? `$${props.visibleSpend.toFixed(2)} reported` : 'No spend reported'}
            detail={props.visibleTokenPosture}
            chips={[
              `${props.entries.length} visible boards`,
              props.visibleSpend > 0 ? 'Spend telemetry live' : 'No spend telemetry',
              props.visibleTokenPosture,
            ]}
            emphasis={props.visibleSpend > 0 || props.visibleTokenPosture !== 'No token telemetry' ? 'success' : 'neutral'}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function TriagePacket(props: {
  title: string;
  headline: string;
  detail: string;
  chips?: string[];
  emphasis: 'neutral' | 'success' | 'warning' | 'destructive';
}): JSX.Element {
  const accentClass =
    props.emphasis === 'destructive'
      ? 'border-rose-300/80 bg-rose-500/5'
      : props.emphasis === 'warning'
        ? 'border-amber-300/80 bg-amber-500/5'
        : props.emphasis === 'success'
          ? 'border-emerald-300/80 bg-emerald-500/5'
          : 'border-border/70 bg-muted/10';
  return (
    <div className={cn('grid gap-2 rounded-xl border p-4 shadow-sm', accentClass)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {props.title}
      </p>
      <p className="text-sm font-semibold leading-6 text-foreground">{props.headline}</p>
      <p className="text-xs leading-5 text-muted">{props.detail}</p>
      {props.chips && props.chips.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {props.chips.map((chip) => (
            <Badge key={`${props.title}:${chip}`} variant="outline">
              {chip}
            </Badge>
          ))}
        </div>
      ) : null}
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
  fleetSummary: ReturnType<typeof summarizeWorkerFleet>;
}

function NeedsAttentionSection({
  approvalTasks,
  failedTasks,
  blockedItems,
  stageGates,
  fleetSummary,
}: NeedsAttentionProps): JSX.Element {
  const totalItems =
    approvalTasks.length + failedTasks.length + blockedItems.length + stageGates.length;
  const fleetAttentionCount = countFleetAttentionSignals(fleetSummary);
  const fleetAttentionLabel = describeFleetAttention(fleetSummary);
  const defaultTab = useMemo(() => {
    if (stageGates.length > 0) {
      return 'gates';
    }
    if (blockedItems.length > 0) {
      return 'blocked';
    }
    if (approvalTasks.length > 0) {
      return 'approvals';
    }
    if (failedTasks.length > 0) {
      return 'failed';
    }
    return 'gates';
  }, [approvalTasks.length, blockedItems.length, failedTasks.length, stageGates.length]);
  const [activeTab, setActiveTab] = useState<'gates' | 'blocked' | 'approvals' | 'failed'>(
    defaultTab as 'gates' | 'blocked' | 'approvals' | 'failed',
  );

  useEffect(() => {
    setActiveTab(defaultTab as 'gates' | 'blocked' | 'approvals' | 'failed');
  }, [defaultTab]);

  if (totalItems === 0 && fleetAttentionCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Operator queue clear
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">
            No stage gates, blocked work items, or specialist-step interventions require
            attention right now.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (totalItems === 0) {
    return (
      <Card className="border-amber-300 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Fleet attention required
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted">
            The operator queue is clear, but worker recovery still needs attention.
          </p>
          <Badge variant="warning">{fleetAttentionLabel}</Badge>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-300 shadow-sm">
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Operator Queue ({totalItems})
            </CardTitle>
            <p className="max-w-3xl text-sm leading-6 text-muted">
              Triage by queue type first, then step into the approval queue or board detail view
              for the actual decision and recovery work.
            </p>
          </div>
          <Badge variant="warning" className="w-fit">
            {activeTab === 'gates'
              ? `${stageGates.length} stage gate${stageGates.length === 1 ? '' : 's'}`
              : activeTab === 'blocked'
                ? `${blockedItems.length} blocked work item${blockedItems.length === 1 ? '' : 's'}`
                : activeTab === 'approvals'
                  ? `${approvalTasks.length} approval${approvalTasks.length === 1 ? '' : 's'}`
                  : `${failedTasks.length} failed step${failedTasks.length === 1 ? '' : 's'}`}
          </Badge>
          {fleetAttentionCount > 0 ? (
            <Badge variant="destructive" className="w-fit">
              {fleetAttentionLabel}
            </Badge>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SnapshotMetric label="Stage gates" value={String(stageGates.length)} />
          <SnapshotMetric label="Blocked work" value={String(blockedItems.length)} />
          <SnapshotMetric label="Approval queue" value={String(approvalTasks.length)} />
          <SnapshotMetric label="Failed steps" value={String(failedTasks.length)} />
        </div>
      </CardHeader>
      <CardContent>
        <Tabs
          value={activeTab}
          onValueChange={(value) =>
            setActiveTab(value as 'gates' | 'blocked' | 'approvals' | 'failed')
          }
          className="grid gap-4"
        >
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-xl border border-border/70 bg-border/10 p-1 xl:grid-cols-4">
            <TabsTrigger value="gates">Stage gates</TabsTrigger>
            <TabsTrigger value="blocked">Blocked work</TabsTrigger>
            <TabsTrigger value="approvals">Approval queue</TabsTrigger>
            <TabsTrigger value="failed">Failed steps</TabsTrigger>
          </TabsList>

          <TabsContent value="gates" className="mt-0 grid gap-3">
            {stageGates.length === 0 ? (
              <AttentionEmptyState message="No stage gates are waiting for review." />
            ) : (
              stageGates.map((gate) => (
                <StageGateQueueCard key={`${gate.workflow_id}:${gate.stage_name}`} gate={gate} />
              ))
            )}
          </TabsContent>

          <TabsContent value="blocked" className="mt-0 grid gap-3">
            {blockedItems.length === 0 ? (
              <AttentionEmptyState message="No blocked work items are visible on this page." />
            ) : (
              blockedItems.map((item) => (
                <BlockedWorkQueueCard
                  key={`${item.workflowId}:${item.workItemId}`}
                  item={item}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="approvals" className="mt-0 grid gap-3">
            {approvalTasks.length === 0 ? (
              <AttentionEmptyState message="No specialist approvals are waiting right now." />
            ) : (
              approvalTasks.map((task) => (
                <SpecialistQueueCard key={task.id} task={task} />
              ))
            )}
          </TabsContent>

          <TabsContent value="failed" className="mt-0 grid gap-3">
            {failedTasks.length === 0 ? (
              <AttentionEmptyState message="No failed specialist steps are waiting for recovery." />
            ) : (
              failedTasks.map((task) => (
                <SpecialistQueueCard key={task.id} task={task} />
              ))
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function AttentionEmptyState(props: { message: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
      {props.message}
    </div>
  );
}

function StageGateQueueCard(props: {
  gate: DashboardApprovalQueueResponse['stage_gates'][number];
}): JSX.Element {
  const { gate } = props;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-2">
        <Link
          to={buildWorkflowDetailPermalink(gate.workflow_id, {
            gateStageName: gate.stage_name,
          })}
          className="block truncate text-sm font-medium text-accent hover:underline"
        >
          {gate.workflow_name}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">stage gate</Badge>
          <Badge variant="outline">{gate.stage_name}</Badge>
        </div>
        <p className="text-sm leading-6 text-muted">{gate.stage_goal}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:ml-4">
        <Button size="sm" asChild>
          <Link to="/work/approvals?view=gates">Open approvals</Link>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link
            to={buildWorkflowDetailPermalink(gate.workflow_id, {
              gateStageName: gate.stage_name,
            })}
          >
            Open board gate
          </Link>
        </Button>
      </div>
    </div>
  );
}

function BlockedWorkQueueCard(props: {
  item: {
    workflowId: string;
    workflowName: string;
    workItemId: string;
    title: string;
    stageName: string;
    columnId: string;
  };
}): JSX.Element {
  const { item } = props;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-2">
        <Link
          to={buildWorkflowDetailPermalink(item.workflowId, {
            workItemId: item.workItemId,
          })}
          className="block truncate text-sm font-medium text-accent hover:underline"
        >
          {item.workflowName}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="destructive">blocked work item</Badge>
          <Badge variant="outline">{item.stageName}</Badge>
          <Badge variant="outline">{item.columnId}</Badge>
        </div>
        <p className="truncate text-sm text-muted">{item.title}</p>
      </div>
      <div className="flex shrink-0 gap-2 sm:ml-4">
        <Button size="sm" variant="outline" asChild>
          <Link
            to={buildWorkflowDetailPermalink(item.workflowId, {
              workItemId: item.workItemId,
            })}
          >
            Open work item
          </Link>
        </Button>
      </div>
    </div>
  );
}

function SpecialistQueueCard(props: { task: TaskRecord }): JSX.Element {
  const { task } = props;
  const taskActions = buildAttentionTaskActions({
    taskId: task.id,
    workflowId: task.workflow_id,
    workItemId: task.work_item_id,
    activationId: task.activation_id,
    state: task.state,
    status: task.status,
  });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="truncate text-sm font-medium text-foreground">
          {task.title ?? task.name ?? task.id}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={
              resolveTaskOperatorState(task) === 'failed' ? 'destructive' : 'warning'
            }
          >
            {describeAttentionStep(task)}
          </Badge>
          {task.stage_name ? <Badge variant="outline">Stage: {task.stage_name}</Badge> : null}
          {task.work_item_id ? <Badge variant="outline">Board work linked</Badge> : null}
          {task.role ? <Badge variant="outline">Role: {task.role}</Badge> : null}
          {task.assigned_worker ? (
            <Badge variant="outline">Worker: {task.assigned_worker}</Badge>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:ml-4">
        {taskActions
          .filter((action) => action.isPrimary)
          .map((action) => (
            <Button key={`${task.id}:${action.label}`} size="sm" asChild>
              <Link to={action.href}>{action.label}</Link>
            </Button>
          ))}
        {resolveTaskOperatorState(task) === 'awaiting_approval' ? (
          <Button size="sm" variant="outline" asChild>
            <Link to="/work/approvals?view=tasks">Open approvals</Link>
          </Button>
        ) : null}
        {taskActions
          .filter((action) => !action.isPrimary)
          .map((action) => (
            <Button key={`${task.id}:${action.label}`} size="sm" variant="outline" asChild>
              <Link to={action.href}>{action.label}</Link>
            </Button>
          ))}
      </div>
    </div>
  );
}

function BoardSnapshotTable(props: {
  entries: LiveBoardEntry[];
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
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>Board Snapshot</CardTitle>
        <p className="text-sm text-muted">
          Compare board posture, pool pressure, progress, spend and tokens, and risk across the current live page.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 lg:hidden">
          {props.entries.map((entry) => {
            const { workflow, board, activations, tasks, gateCount, isLoading, hasError } = entry;
            const posture = resolveBoardPosture(workflow, board);
            const activationSummary = summarizeActivationHealth(activations);
            const specialistSummary = summarizeSpecialistPosture(tasks);
            const riskPosture = describeRiskPosture({
              blocked: countBlockedBoardItems(board),
              gates: gateCount,
              failed: specialistSummary.failed,
              escalated: specialistSummary.escalations,
              reworkHeavy: specialistSummary.reworkHeavy,
              staleActivations: activationSummary.stale,
            });
            return (
              <div
                key={workflow.id}
                className="grid gap-3 rounded-xl border border-border/70 bg-muted/10 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      className="block truncate text-sm font-semibold text-accent hover:underline"
                      to={`/work/boards/${workflow.id}`}
                    >
                      {workflow.name}
                    </Link>
                    <p className="text-xs text-muted">{describeBoardHeadline(workflow, board)}</p>
                  </div>
                  <Badge variant={statusBadgeVariant(posture)}>{posture}</Badge>
                </div>
                <WorkflowProgressPanel workflow={workflow} board={board} />
                <div className="grid gap-3 rounded-lg border border-border/60 bg-background/70 p-3 sm:grid-cols-2 xl:grid-cols-3">
                  <SnapshotMetric
                    label={describeWorkflowStageLabel(workflow)}
                    value={describeWorkflowStage(workflow)}
                  />
                  <SnapshotMetric
                    label="Orchestrator pool"
                    value={isLoading ? 'Loading…' : hasError ? 'Unavailable' : describeOrchestratorPool(activationSummary)}
                  />
                  <SnapshotMetric
                    label="Specialist pool"
                    value={describeSpecialistPool(specialistSummary)}
                  />
                  <SnapshotMetric
                    label="Spend & tokens"
                    value={`${describeBoardSpend(workflow)} • ${describeBoardTokens(workflow)}`}
                  />
                  <SnapshotMetric label="Risk" value={isLoading ? 'Loading…' : hasError ? 'Unavailable' : riskPosture} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="hidden overflow-x-auto lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Board</TableHead>
                <TableHead>Posture</TableHead>
                <TableHead>Pools</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Spend &amp; Tokens</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.entries.map((entry) => {
                const { workflow, board, activations, tasks, gateCount, isLoading, hasError } = entry;
                const posture = resolveBoardPosture(workflow, board);
                const activationSummary = summarizeActivationHealth(activations);
                const specialistSummary = summarizeSpecialistPosture(tasks);
                const riskPosture = describeRiskPosture({
                  blocked: countBlockedBoardItems(board),
                  gates: gateCount,
                  failed: specialistSummary.failed,
                  escalated: specialistSummary.escalations,
                  reworkHeavy: specialistSummary.reworkHeavy,
                  staleActivations: activationSummary.stale,
                });
                return (
                  <TableRow key={workflow.id}>
                    <TableCell className="align-top font-medium">
                      <div className="space-y-1">
                        <Link
                          className="text-accent hover:underline"
                          to={`/work/boards/${workflow.id}`}
                        >
                          {workflow.name}
                        </Link>
                        <p className="text-xs text-muted">
                          {describeWorkflowStageSummary(workflow)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="space-y-1">
                        <Badge variant={statusBadgeVariant(posture)}>{posture}</Badge>
                        <p className="text-xs text-muted">
                          {describeBoardHeadline(workflow, board)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="space-y-2 text-sm">
                        <p>{isLoading ? 'Loading…' : hasError ? 'Unavailable' : describeOrchestratorPool(activationSummary)}</p>
                        <p className="text-muted">{describeSpecialistPool(specialistSummary)}</p>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      <WorkflowProgressPanel workflow={workflow} board={board} compact />
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="space-y-1 text-sm">
                        <p>{describeBoardSpend(workflow)}</p>
                        <p className="text-muted">{describeBoardTokens(workflow)}</p>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      {isLoading ? 'Loading…' : hasError ? 'Unavailable' : riskPosture}
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      {formatRelativeTimestamp(workflow.started_at ?? workflow.created_at)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivePlaybookBoards(props: {
  entries: LiveBoardEntry[];
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
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>Live Boards</CardTitle>
        <p className="text-sm text-muted">
          Each card keeps posture, progress, and recovery signals above the fold, then reveals
          active work only when you need it.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 xl:grid-cols-2">
          {props.entries.map((entry) => {
            const { workflow, board, activations, tasks, gateCount, isLoading, hasError } = entry;
            const activeItems = board
              ? board.work_items.filter((item) => {
                  const column = board.columns.find((candidate) => candidate.id === item.column_id);
                  return !column?.is_terminal;
                })
              : [];
            const activationSummary = summarizeActivationHealth(activations);
            const specialistSummary = summarizeSpecialistPosture(tasks);
            const riskPosture = describeRiskPosture({
              blocked: countBlockedBoardItems(board),
              gates: gateCount,
              failed: specialistSummary.failed,
              escalated: specialistSummary.escalations,
              reworkHeavy: specialistSummary.reworkHeavy,
              staleActivations: activationSummary.stale,
            });
            const visibleActiveItems = activeItems.slice(0, 3);
            const remainingActiveItems = activeItems.slice(3);
            return (
              <div
                key={workflow.id}
                className="grid gap-4 rounded-xl border border-border/70 bg-muted/10 p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={`/work/boards/${workflow.id}`}
                      className="block truncate font-medium text-accent hover:underline"
                    >
                      {workflow.name}
                    </Link>
                    <p className="text-xs text-muted">{describeBoardHeadline(workflow, board)}</p>
                  </div>
                  <Badge variant={statusBadgeVariant(resolveBoardPosture(workflow, board))}>
                    {resolveBoardPosture(workflow, board)}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {activeItems.length} active work item{activeItems.length === 1 ? '' : 's'}
                  </Badge>
                  <Badge variant="outline">
                    {gateCount} gate review{gateCount === 1 ? '' : 's'}
                  </Badge>
                  <Badge variant="outline">
                    {specialistSummary.failed} failed step{specialistSummary.failed === 1 ? '' : 's'}
                  </Badge>
                </div>
                <WorkflowProgressPanel workflow={workflow} board={board} />
                <div className="grid gap-3 rounded-lg border border-border/60 bg-background/80 p-3 sm:grid-cols-2 xl:grid-cols-3">
                  <SnapshotMetric
                    label={describeWorkflowStageLabel(workflow)}
                    value={describeWorkflowStage(workflow)}
                  />
                  <SnapshotMetric
                    label="Spend & tokens"
                    value={`${describeBoardSpend(workflow)} • ${describeBoardTokens(workflow)}`}
                  />
                  <SnapshotMetric
                    label="Orchestrator pool"
                    value={isLoading ? 'Loading…' : hasError ? 'Unavailable' : describeOrchestratorPool(activationSummary)}
                  />
                  <SnapshotMetric
                    label="Specialist pool"
                    value={describeSpecialistPool(specialistSummary)}
                  />
                  <SnapshotMetric
                    label="Risk posture"
                    value={isLoading ? 'Loading…' : hasError ? 'Unavailable' : riskPosture}
                  />
                  <SnapshotMetric
                    label="Age"
                    value={formatRelativeTimestamp(workflow.started_at ?? workflow.created_at)}
                  />
                </div>
                {isLoading ? <p className="mt-3 text-sm text-muted">Loading board...</p> : null}
                {hasError ? <p className="mt-3 text-sm text-red-600">Failed to load board.</p> : null}
                {!isLoading && !hasError ? (
                  <div className="mt-3 grid gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">Most active work</p>
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/work/boards/${workflow.id}`}>Open board</Link>
                      </Button>
                    </div>
                    {visibleActiveItems.map((item) => (
                      <BoardWorkItemCard
                        key={item.id}
                        workflowId={workflow.id}
                        item={item}
                        tasks={tasks}
                      />
                    ))}
                    {remainingActiveItems.length > 0 ? (
                      <details className="rounded-xl border border-border/70 bg-background/70 p-3">
                        <summary className="cursor-pointer text-sm font-medium text-foreground">
                          Show remaining active work items ({remainingActiveItems.length})
                        </summary>
                        <div className="mt-3 grid gap-2">
                          {remainingActiveItems.map((item) => (
                            <BoardWorkItemCard
                              key={`remaining:${item.id}`}
                              workflowId={workflow.id}
                              item={item}
                              tasks={tasks}
                            />
                          ))}
                        </div>
                      </details>
                    ) : null}
                    {activeItems.length === 0 ? (
                      <p className="text-sm text-muted">
                        No active work items outside terminal columns.
                      </p>
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

function WorkflowProgressPanel(props: {
  workflow: WorkflowRecord;
  board?: DashboardWorkflowBoardResponse;
  compact?: boolean;
}): JSX.Element {
  const percent = readBoardProgressPercent(props.workflow, props.board);
  const stageSteps = buildWorkflowStageProgressSteps(props.workflow, props.board);
  const progressSummary = describeWorkflowStageProgressSummary(props.workflow, props.board);
  const detailClass = props.compact
    ? 'grid gap-2'
    : 'grid gap-3 rounded-lg border border-border/60 bg-background/80 p-3';

  return (
    <div className={detailClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Stage progress
          </p>
          <p className="text-sm font-medium text-foreground">{progressSummary}</p>
        </div>
        <Badge variant="outline">
          {props.workflow.lifecycle === 'continuous'
            ? '∞ continuous'
            : percent === null
              ? 'No percent yet'
              : `${percent}% complete`}
        </Badge>
      </div>
      <div className="grid gap-2">
        <div className="h-2 overflow-hidden rounded-full bg-border/60">
          <div
            className={cn(
              'h-2 rounded-full transition-[width]',
              props.workflow.lifecycle === 'continuous'
                ? 'bg-[linear-gradient(90deg,hsl(var(--accent))_0%,hsl(var(--accent))_55%,rgba(245,158,11,0.85)_100%)]'
                : 'bg-accent',
            )}
            style={{
              width: `${readProgressWidth(
                props.workflow.lifecycle === 'continuous' ? 100 : percent,
              )}%`,
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs leading-5 text-muted">
          <span>{describeBoardProgress(props.workflow, props.board)}</span>
          <span>
            {props.workflow.lifecycle === 'continuous'
              ? 'Continuous intake'
              : percent === null
                ? 'Awaiting completed work'
                : `${percent}% delivered`}
          </span>
        </div>
      </div>
      {stageSteps.length > 0 ? (
        <div className="grid gap-2">
          <div className="flex gap-1" aria-label="Stage progress">
            {stageSteps.map((step) => (
              <span
                key={`${props.workflow.id}:${step.name}`}
                className={cn('h-2 min-w-0 flex-1 rounded-full', stageProgressToneClass(step.tone))}
                title={`${step.name}: ${step.detail}`}
              />
            ))}
          </div>
          {!props.compact ? (
            <div className="flex flex-wrap gap-2">
              {stageSteps.map((step) => (
                <Badge
                  key={`badge:${props.workflow.id}:${step.name}`}
                  variant={stageProgressToneVariant(step.tone)}
                >
                  {step.name}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BoardWorkItemCard(props: {
  workflowId: string;
  item: DashboardWorkflowBoardResponse['work_items'][number];
  tasks: TaskRecord[];
}): JSX.Element {
  const reworkCount = countWorkItemReworks(props.tasks, props.item.id);
  const operatorSummary = describeWorkItemOperatorSummary(props.tasks, props.item.id);

  return (
    <div className="rounded-md border border-border/60 bg-background/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <Link
            to={buildWorkflowDetailPermalink(props.workflowId, { workItemId: props.item.id })}
            className="block truncate text-sm font-medium text-accent hover:underline"
          >
            {props.item.title}
          </Link>
          <p className="text-xs leading-5 text-muted">{operatorSummary}</p>
        </div>
        <Badge variant="outline">{props.item.column_id}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
        <Badge variant="outline">{props.item.stage_name}</Badge>
        {props.item.owner_role ? <Badge variant="outline">{props.item.owner_role}</Badge> : null}
        {props.item.task_count !== undefined ? (
          <Badge variant="outline">{props.item.task_count} specialist steps</Badge>
        ) : null}
        {reworkCount > 0 ? (
          <Badge variant="warning">
            {reworkCount} rework{reworkCount === 1 ? '' : 's'}
          </Badge>
        ) : null}
        <Badge variant="outline">{props.item.priority}</Badge>
      </div>
    </div>
  );
}

interface FleetStatusPanelProps {
  workers: WorkerRecord[];
}

function FleetStatusPanel({ workers }: FleetStatusPanelProps): JSX.Element {
  const fleetSummary = summarizeWorkerFleet(workers);
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-4 w-4" />
          Fleet Status
        </CardTitle>
        <p className="text-sm text-muted">
          {describeFleetHeadline(fleetSummary)}. Use this to spot capacity gaps before work starts queueing.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SnapshotMetric label="Online" value={String(fleetSummary.online)} />
          <SnapshotMetric label="Busy" value={String(fleetSummary.busy)} />
          <SnapshotMetric label="Available" value={String(fleetSummary.available)} />
          <SnapshotMetric label="Assigned steps" value={String(fleetSummary.assignedSteps)} />
        </div>
        {workers.length === 0 ? (
          <p className="text-sm text-muted">No workers registered.</p>
        ) : (
          <div className="space-y-2">
            {workers.map((w) => (
              <div key={w.id} className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2">
                  <Cpu className="h-4 w-4 text-muted" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">{w.name ?? w.id}</p>
                    <p className="text-xs text-muted">{describeWorkerCapacity(w)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusBadgeVariant(w.status)}>{w.status}</Badge>
                  {w.current_tasks != null ? (
                    <Badge variant="outline">{w.current_tasks} assigned</Badge>
                  ) : null}
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
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>Specialist Step Throughput (24h)</CardTitle>
        <p className="text-sm text-muted">
          Recent completions only. Use this to spot drops in execution flow, not for billing.
        </p>
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
  context: ReturnType<typeof buildTimelineContext>;
  events: DashboardEventRecord[];
  workflowMaps: LiveEventWorkflowMaps;
}

function LiveEventStream({ context, events, workflowMaps }: LiveEventStreamProps): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Live Event Stream
        </CardTitle>
        <p className="text-sm text-muted">
          Latest human-readable operator activity across the visible live scope.
        </p>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted">No recent events.</p>
        ) : (
          <div className="space-y-2">
            {events.map((evt) => {
              const descriptor = describeTimelineEvent(evt, context);
              const workflowId = resolveLiveEventWorkflowId(evt, descriptor, workflowMaps);
              const actions = workflowId
                ? buildTimelineEntryActions({
                    activationId: descriptor.activationId,
                    childWorkflowHref: descriptor.childWorkflowHref,
                    childWorkflowId: descriptor.childWorkflowId,
                    gateStageName: descriptor.gateStageName,
                    workflowId,
                    workItemId: descriptor.workItemId,
                    taskId: descriptor.taskId,
                  })
                : [];
              return (
                <div
                  key={evt.id}
                  className="grid gap-3 rounded-xl border border-border/70 bg-muted/10 p-3 text-sm shadow-sm"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{descriptor.actorLabel}</Badge>
                        <Badge variant={descriptor.emphasisTone}>{descriptor.emphasisLabel}</Badge>
                        {descriptor.stageName ? (
                          <Badge variant="outline">{descriptor.stageName}</Badge>
                        ) : null}
                        {descriptor.signalBadges.map((badge) => (
                          <Badge key={`${evt.id}:${badge}`} variant="outline">
                            {badge}
                          </Badge>
                        ))}
                      </div>
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">
                          {descriptor.narrativeHeadline}
                        </p>
                        {descriptor.summary ? (
                          <p className="text-sm text-muted">{descriptor.summary}</p>
                        ) : (
                          <p className="text-sm text-muted">Recent operator activity recorded.</p>
                        )}
                        {descriptor.outcomeLabel &&
                        descriptor.outcomeLabel !== descriptor.summary ? (
                          <p className="text-sm text-foreground">{descriptor.outcomeLabel}</p>
                        ) : null}
                        {descriptor.scopeSummary ? (
                          <p className="text-xs leading-5 text-muted">
                            {descriptor.scopeSummary}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted">
                      <p>{formatRelativeTimestamp(evt.created_at)}</p>
                      <p>{new Date(evt.created_at).toLocaleTimeString()}</p>
                    </div>
                  </div>
                  {actions.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                      {actions.map((action) => (
                        <Link
                          key={`${evt.id}:${action.label}`}
                          to={action.href}
                          className="underline-offset-4 hover:text-foreground hover:underline"
                        >
                          {action.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SnapshotMetric(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {props.label}
      </p>
      <p className="text-sm text-foreground">{props.value}</p>
    </div>
  );
}

function readProgressWidth(percent: number | null): number {
  if (percent === null) {
    return 0;
  }
  if (percent === 0) {
    return 4;
  }
  return percent;
}

function stageProgressToneClass(
  tone: ReturnType<typeof buildWorkflowStageProgressSteps>[number]['tone'],
): string {
  switch (tone) {
    case 'done':
      return 'bg-emerald-500';
    case 'active':
      return 'bg-accent';
    case 'attention':
      return 'bg-amber-500';
    default:
      return 'bg-border';
  }
}

function stageProgressToneVariant(
  tone: ReturnType<typeof buildWorkflowStageProgressSteps>[number]['tone'],
): 'success' | 'default' | 'warning' | 'outline' {
  switch (tone) {
    case 'done':
      return 'success';
    case 'active':
      return 'default';
    case 'attention':
      return 'warning';
    default:
      return 'outline';
  }
}

interface LiveEventWorkflowMaps {
  activationsById: Map<string, string>;
  tasksById: Map<string, string>;
  workItemsById: Map<string, string>;
}

function buildLiveTimelineContext(
  entries: LiveBoardEntry[],
  tasks: TaskRecord[],
): ReturnType<typeof buildTimelineContext> {
  const timelineTasks: DashboardWorkflowTaskRow[] = tasks.map((task) => ({
    id: task.id,
    title: task.title ?? task.name ?? task.id,
    state: task.state ?? task.status,
    depends_on: [],
    work_item_id: task.work_item_id ?? null,
    role: task.role ?? null,
    stage_name: task.stage_name ?? null,
  }));

  return buildTimelineContext({
    activations: entries.flatMap((entry) => entry.activations),
    childWorkflows: [],
    stages: [],
    tasks: timelineTasks,
    workItems: entries.flatMap((entry) => entry.board?.work_items ?? []),
  });
}

function buildLiveEventWorkflowMaps(
  entries: LiveBoardEntry[],
  tasks: TaskRecord[],
): LiveEventWorkflowMaps {
  const activationsById = new Map<string, string>();
  for (const activation of entries.flatMap((entry) => entry.activations)) {
    activationsById.set(activation.id, activation.workflow_id);
    if (activation.activation_id) {
      activationsById.set(activation.activation_id, activation.workflow_id);
    }
  }

  const tasksById = new Map<string, string>();
  for (const task of tasks) {
    if (task.workflow_id) {
      tasksById.set(task.id, task.workflow_id);
    }
  }

  const workItemsById = new Map<string, string>();
  for (const workItem of entries.flatMap((entry) => entry.board?.work_items ?? [])) {
    workItemsById.set(workItem.id, workItem.workflow_id);
  }

  return { activationsById, tasksById, workItemsById };
}

function resolveLiveEventWorkflowId(
  event: DashboardEventRecord,
  descriptor: ReturnType<typeof describeTimelineEvent>,
  maps: LiveEventWorkflowMaps,
): string | null {
  const explicitWorkflowId = readEventString(event.data?.workflow_id);
  if (explicitWorkflowId) {
    return explicitWorkflowId;
  }
  if (event.entity_type === 'workflow' && event.entity_id) {
    return event.entity_id;
  }
  if (descriptor.workItemId) {
    const workItemWorkflowId = maps.workItemsById.get(descriptor.workItemId);
    if (workItemWorkflowId) {
      return workItemWorkflowId;
    }
  }
  if (descriptor.taskId) {
    const taskWorkflowId = maps.tasksById.get(descriptor.taskId);
    if (taskWorkflowId) {
      return taskWorkflowId;
    }
  }
  if (descriptor.activationId) {
    const activationWorkflowId = maps.activationsById.get(descriptor.activationId);
    if (activationWorkflowId) {
      return activationWorkflowId;
    }
  }
  return null;
}

function readEventString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
