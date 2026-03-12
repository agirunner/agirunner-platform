import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Clock,
  Container,
  Gauge,
  Loader2,
  Pause,
  Play,
  Server,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  dashboardApi,
  type FleetEventRecord,
  type FleetPlaybookPoolSummary,
  type FleetStatusResponse,
  type FleetWorkerPoolSummary,
} from '../../lib/api.js';

const REFETCH_INTERVAL_MS = 5000;
const EVENTS_PER_PAGE = 10;

function truncateId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}...` : id;
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function formatEventDetails(event: FleetEventRecord): string {
  const payload = event.payload ?? {};
  const reason = typeof payload.reason === 'string' ? payload.reason : null;
  const image = typeof payload.image === 'string' ? payload.image : null;
  const status = typeof payload.status === 'string' ? payload.status : null;
  const parts = [reason, image, status].filter((value): value is string => Boolean(value));
  if (parts.length > 0) {
    return parts.join(' · ');
  }
  return 'No additional details';
}

function poolLabel(poolKind: 'orchestrator' | 'specialist'): string {
  return poolKind === 'orchestrator' ? 'Orchestrator Pool' : 'Specialist Pool';
}

function StatCard({
  label,
  value,
  icon: Icon,
  variant,
}: {
  label: string;
  value: number;
  icon: typeof Activity;
  variant?: string;
}): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className={cn('h-5 w-5', variant ?? 'text-muted-foreground')} />
        <div>
          <p className="text-2xl font-semibold">{value}</p>
          <p className="text-xs text-muted">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkerPoolsOverview({ pools }: { pools: FleetWorkerPoolSummary[] }): JSX.Element {
  const orderedPools: Array<'orchestrator' | 'specialist'> = ['orchestrator', 'specialist'];

  return (
    <div>
      <h2 className="mb-3 text-lg font-medium">Worker Pools</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {orderedPools.map((poolKind) => {
          const pool = pools.find((entry) => entry.pool_kind === poolKind);
          return (
            <Card key={poolKind}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{poolLabel(poolKind)}</CardTitle>
                  <Badge variant={poolKind === 'orchestrator' ? 'secondary' : 'outline'}>
                    {poolKind}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                <PoolMetric label="Desired workers" value={pool?.desired_workers ?? 0} />
                <PoolMetric label="Desired replicas" value={pool?.desired_replicas ?? 0} />
                <PoolMetric label="Enabled" value={pool?.enabled_workers ?? 0} />
                <PoolMetric label="Running" value={pool?.running_containers ?? 0} />
                <PoolMetric label="Draining" value={pool?.draining_workers ?? 0} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function PoolMetric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xl font-semibold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function GlobalOverview({ status }: { status: FleetStatusResponse }): JSX.Element {
  const usagePercent =
    status.global_max_runtimes > 0
      ? Math.round((status.total_running / status.global_max_runtimes) * 100)
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4" />
          Global Overview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Total Runtimes</span>
            <span className="font-medium">
              {status.total_running} / {status.global_max_runtimes}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted/20">
            <div
              className={cn(
                'h-2 rounded-full transition-all',
                usagePercent > 90 ? 'bg-red-500' : usagePercent > 70 ? 'bg-yellow-500' : 'bg-green-500',
              )}
              style={{ width: `${Math.min(usagePercent, 100)}%` }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Running" value={status.total_running} icon={Play} variant="text-green-600" />
          <StatCard label="Idle" value={status.total_idle} icon={Pause} variant="text-yellow-600" />
          <StatCard label="Executing" value={status.total_executing} icon={Activity} variant="text-blue-600" />
          <StatCard label="Draining" value={status.total_draining} icon={Clock} variant="text-orange-600" />
        </div>
      </CardContent>
    </Card>
  );
}

function PlaybookPoolCard({
  pool,
}: {
  pool: FleetPlaybookPoolSummary;
}): JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{pool.playbook_name}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={pool.pool_kind === 'orchestrator' ? 'secondary' : 'outline'}>
              {pool.pool_kind}
            </Badge>
            <Badge variant={pool.pool_mode === 'warm' ? 'success' : 'secondary'}>
              {pool.pool_mode}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Runtimes</span>
          <span className="font-medium">
            {pool.running} / {pool.max_runtimes}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <div className="rounded-md border border-border p-2">
            <p className="font-semibold text-green-600">{pool.running}</p>
            <p className="text-muted">Running</p>
          </div>
          <div className="rounded-md border border-border p-2">
            <p className="font-semibold text-yellow-600">{pool.idle}</p>
            <p className="text-muted">Idle</p>
          </div>
          <div className="rounded-md border border-border p-2">
            <p className="font-semibold text-blue-600">{pool.executing}</p>
            <p className="text-muted">Executing</p>
          </div>
          <div className="rounded-md border border-border p-2">
            <p className="font-semibold text-orange-600">{pool.draining}</p>
            <p className="text-muted">Draining</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex items-center gap-1">
            <span className="text-muted">Pending:</span>
            <span className="font-medium">{pool.pending_tasks}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted">Workflows:</span>
            <span className="font-medium">{pool.active_workflows}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const LEVEL_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  debug: 'secondary',
  info: 'secondary',
  warn: 'warning',
  error: 'destructive',
};

function EventsTable({
  playbooks,
}: {
  playbooks: Array<{ playbook_id: string; playbook_name: string }>;
}): JSX.Element {
  const [page, setPage] = useState(1);
  const [playbookFilter, setPlaybookFilter] = useState<string>('');

  const { data, isLoading } = useQuery({
    queryKey: ['fleet-events', page, playbookFilter],
    queryFn: () =>
      dashboardApi.fetchFleetEvents({
        limit: String(EVENTS_PER_PAGE),
        offset: String((page - 1) * EVENTS_PER_PAGE),
        ...(playbookFilter ? { playbook_id: playbookFilter } : {}),
      }),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  const events = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / EVENTS_PER_PAGE));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Recent Events</CardTitle>
          <Select
            value={playbookFilter}
            onValueChange={(val) => {
              setPlaybookFilter(val === 'all' ? '' : val);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All playbooks" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All playbooks</SelectItem>
              {playbooks.map((playbook) => (
                <SelectItem key={playbook.playbook_id} value={playbook.playbook_id}>
                  {playbook.playbook_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted">No events found.</p>
        ) : (
          <>
            <div className="grid gap-3 md:hidden">
              {events.map((event) => (
                <div key={event.id} className="rounded-lg border border-border/70 bg-muted/10 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">{event.event_type}</div>
                      <div className="text-xs text-muted">{formatTimestamp(event.created_at)}</div>
                    </div>
                    <Badge variant={LEVEL_VARIANT[event.level] ?? 'secondary'}>
                      {event.level}
                    </Badge>
                  </div>
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="text-muted">Runtime {event.runtime_id ? truncateId(event.runtime_id) : '-'}</div>
                    <div className="text-muted">{formatEventDetails(event)}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="pb-2 pr-4">Time</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4">Level</th>
                    <th className="pb-2 pr-4">Runtime ID</th>
                    <th className="pb-2">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className="border-b border-border/50">
                      <td className="py-2 pr-4 text-xs text-muted whitespace-nowrap">
                        {formatTimestamp(event.created_at)}
                      </td>
                      <td className="py-2 pr-4 font-medium">{event.event_type}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={LEVEL_VARIANT[event.level] ?? 'secondary'}>
                          {event.level}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs" title={event.runtime_id ?? ''}>
                        {event.runtime_id ? truncateId(event.runtime_id) : '-'}
                      </td>
                      <td className="py-2 text-muted">{formatEventDetails(event)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function FleetStatusPage(): JSX.Element {
  const { data: status, isLoading, isError } = useQuery({
    queryKey: ['fleet-status'],
    queryFn: () => dashboardApi.fetchFleetStatus(),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  const playbookFilters = useMemo(
    () =>
      Array.from(
        new Map(
          (status?.by_playbook_pool ?? []).map((pool) => [
            pool.playbook_id,
            { playbook_id: pool.playbook_id, playbook_name: pool.playbook_name },
          ]),
        ).values(),
      ),
    [status?.by_playbook_pool],
  );

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-48 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !status) {
    return (
      <div className="p-6 text-red-600">
        Failed to load fleet status.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Container className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Fleet Status</h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Auto-refreshing
        </div>
      </div>

      <GlobalOverview status={status} />
      <WorkerPoolsOverview pools={status.worker_pools ?? []} />

      {(status.by_playbook_pool ?? []).length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-medium">Per-Playbook Pool Status</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {status.by_playbook_pool.map((playbookPool) => (
              <PlaybookPoolCard
                key={`${playbookPool.playbook_id}:${playbookPool.pool_kind}`}
                pool={playbookPool}
              />
            ))}
          </div>
        </div>
      )}

      <EventsTable playbooks={playbookFilters} />
    </div>
  );
}
