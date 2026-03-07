import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Container,
  DollarSign,
  Cpu,
  Server,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { dashboardApi, type DashboardEventRecord } from '../../lib/api.js';
import { subscribeToEvents } from '../../lib/sse.js';
import { cn } from '../../lib/utils.js';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';

interface WorkflowRecord {
  id: string;
  name: string;
  state?: string;
  status?: string;
  phases?: Array<{ name: string; status?: string }>;
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
  output?: unknown;
  assigned_worker?: string | null;
  workflow_id?: string;
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
    case 'running':
    case 'online':
      return 'success';
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

export function LiveBoardPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [sseEvents, setSseEvents] = useState<DashboardEventRecord[]>([]);

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

  const activeWorkflows = useMemo(() => workflows.filter((w) => w.state === 'running' || w.state === 'active'), [workflows]);
  const runningTasks = useMemo(() => tasks.filter((t) => t.status === 'running'), [tasks]);
  const onlineWorkers = useMemo(() => workers.filter((w) => w.status === 'online' || w.status === 'active'), [workers]);
  const approvalTasks = useMemo(() => tasks.filter((t) => t.status === 'awaiting_approval'), [tasks]);
  const failedTasks = useMemo(() => tasks.filter((t) => t.status === 'failed'), [tasks]);
  const needsAction = approvalTasks.length + failedTasks.length;
  const throughputData = useMemo(() => buildThroughputData(apiEvents), [apiEvents]);

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
      <h1 className="text-2xl font-semibold">Live Board</h1>

      <KpiCards
        activeWorkflows={activeWorkflows.length}
        runningTasks={runningTasks.length}
        workersOnline={onlineWorkers.length}
        containersRunning={onlineWorkers.length}
        needsAction={needsAction}
      />

      <NeedsAttentionSection approvalTasks={approvalTasks} failedTasks={failedTasks} />

      <WorkflowStatusTable workflows={activeWorkflows} tasks={tasks} />

      <div className="grid gap-6 lg:grid-cols-2">
        <FleetStatusPanel workers={workers} />
        <ThroughputChart data={throughputData} />
      </div>

      <LiveEventStream events={recentEvents} />
    </div>
  );
}

interface KpiCardsProps {
  activeWorkflows: number;
  runningTasks: number;
  workersOnline: number;
  containersRunning: number;
  needsAction: number;
}

function KpiCards(props: KpiCardsProps): JSX.Element {
  const cards = [
    { label: 'Active Workflows', value: props.activeWorkflows, icon: WorkflowIcon, color: 'text-blue-600' },
    { label: 'Running Tasks', value: props.runningTasks, icon: Activity, color: 'text-green-600' },
    { label: 'Workers Online', value: props.workersOnline, icon: Server, color: 'text-indigo-600' },
    { label: 'Containers Running', value: props.containersRunning, icon: Container, color: 'text-purple-600' },
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
}

function NeedsAttentionSection({ approvalTasks, failedTasks }: NeedsAttentionProps): JSX.Element {
  const items = [...approvalTasks, ...failedTasks];

  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            All Clear
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">No tasks require your attention right now.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          Needs Your Attention ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {items.map((task) => (
            <div key={task.id} className="flex items-center justify-between rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">{task.title ?? task.name ?? task.id}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant={task.status === 'failed' ? 'destructive' : 'warning'}>
                    {task.status.replace(/_/g, ' ')}
                  </Badge>
                  {task.assigned_worker && (
                    <span className="text-xs text-muted">Worker: {task.assigned_worker}</span>
                  )}
                </div>
              </div>
              <div className="ml-4 flex shrink-0 gap-2">
                {task.status === 'awaiting_approval' && (
                  <>
                    <Button size="sm" onClick={() => dashboardApi.approveTask(task.id)}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => dashboardApi.rejectTask(task.id, { feedback: 'Rejected from live board' })}>Reject</Button>
                  </>
                )}
                {task.status === 'failed' && (
                  <Button size="sm" variant="outline" onClick={() => dashboardApi.retryTask(task.id)}>Retry</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface WorkflowStatusTableProps {
  workflows: WorkflowRecord[];
  tasks: TaskRecord[];
}

function WorkflowStatusTable({ workflows, tasks }: WorkflowStatusTableProps): JSX.Element {
  if (workflows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Workflow Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">No active workflows.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflow Status</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phase</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workflows.map((wf) => {
              const wfTasks = tasks.filter((t) => t.workflow_id === wf.id);
              const completed = wfTasks.filter((t) => t.status === 'completed').length;
              const total = wfTasks.length || 1;
              const percent = Math.round((completed / total) * 100);
              const currentPhase = wf.phases?.find((p) => p.status === 'running')?.name ?? '--';
              const cost = wf.metrics?.total_cost_usd;

              return (
                <TableRow key={wf.id}>
                  <TableCell className="font-medium">{wf.name}</TableCell>
                  <TableCell>{currentPhase}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded-full bg-border/40">
                        <div
                          className="h-2 rounded-full bg-accent transition-all"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted">{completed}/{total}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{cost != null ? `$${cost.toFixed(4)}` : '--'}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(wf.state ?? '')}>{wf.state ?? 'unknown'}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
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
                    <span className="text-xs text-muted">{w.current_tasks} tasks</span>
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
        <CardTitle>Task Throughput (24h)</CardTitle>
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
