import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Flame, Settings2 } from 'lucide-react';

import {
  dashboardApi,
  type FleetContainerRecord,
  type FleetStatusResponse,
} from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';

type PoolKind = 'orchestrator' | 'specialist';

interface PoolSummary {
  key: string;
  workerRole: string;
  poolKind: PoolKind;
  idleContainers: number;
  activeContainers: number;
}

function normalizePoolKind(value: string | null | undefined): PoolKind {
  return value === 'orchestrator' ? 'orchestrator' : 'specialist';
}

function poolLabel(poolKind: PoolKind): string {
  return poolKind === 'orchestrator' ? 'Orchestrator Warm Pool' : 'Specialist Warm Pool';
}

function buildPoolSummaries(containers: FleetContainerRecord[]): PoolSummary[] {
  const pools = new Map<string, PoolSummary>();

  for (const container of containers) {
    const poolKind = normalizePoolKind(container.pool_kind);
    const key = `${poolKind}:${container.worker_role}`;
    const current = pools.get(key);
    const normalizedStatus = container.status.toLowerCase();
    const isIdle = normalizedStatus === 'idle' || normalizedStatus === 'created';
    const isActive = normalizedStatus === 'running';

    if (current) {
      current.idleContainers += isIdle ? 1 : 0;
      current.activeContainers += isActive ? 1 : 0;
      continue;
    }

    pools.set(key, {
      key,
      workerRole: container.worker_role,
      poolKind,
      idleContainers: isIdle ? 1 : 0,
      activeContainers: isActive ? 1 : 0,
    });
  }

  return [...pools.values()];
}

function PoolBadge({ poolKind }: { poolKind: PoolKind }): JSX.Element {
  return (
    <Badge variant={poolKind === 'orchestrator' ? 'secondary' : 'outline'}>{poolKind}</Badge>
  );
}

function PoolMetric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-lg border border-border/70 bg-surface/80 p-3">
      <p className="text-xl font-semibold text-foreground">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function PoolStateCards({ status }: { status: FleetStatusResponse | undefined }): JSX.Element | null {
  if (!status) {
    return null;
  }

  const orderedPools: PoolKind[] = ['orchestrator', 'specialist'];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {orderedPools.map((poolKind) => {
        const pool = status.worker_pools.find((entry) => entry.pool_kind === poolKind);
        return (
          <Card key={poolKind}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base">{poolLabel(poolKind)}</CardTitle>
                  <CardDescription>
                    Desired state for workers that keep this warm pool available.
                  </CardDescription>
                </div>
                <PoolBadge poolKind={poolKind} />
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <PoolMetric label="Desired replicas" value={pool?.desired_replicas ?? 0} />
              <PoolMetric label="Enabled workers" value={pool?.enabled_workers ?? 0} />
              <PoolMetric label="Running" value={pool?.running_containers ?? 0} />
              <PoolMetric label="Draining" value={pool?.draining_workers ?? 0} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function truncateContainerId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}...` : value;
}

export function WarmPoolsPage(): JSX.Element {
  const containersQuery = useQuery({
    queryKey: ['fleet-containers-warm'],
    queryFn: () => dashboardApi.fetchFleetContainers(),
  });
  const fleetStatusQuery = useQuery({
    queryKey: ['fleet-status'],
    queryFn: () => dashboardApi.fetchFleetStatus(),
  });

  const containers = containersQuery.data ?? [];
  const pools = useMemo(() => buildPoolSummaries(containers), [containers]);
  const warmContainers = useMemo(
    () =>
      containers.filter((container) =>
        ['idle', 'created'].includes(container.status.toLowerCase()),
      ),
    [containers],
  );

  if (containersQuery.isLoading) {
    return <div className="p-6 text-muted">Loading warm pool data...</div>;
  }

  if (containersQuery.error) {
    return <div className="p-6 text-red-600">Failed to load warm pool data.</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Flame className="h-6 w-6 text-muted" />
            <h1 className="text-2xl font-semibold">Warm Pools</h1>
          </div>
          <p className="max-w-2xl text-sm text-muted">
            Monitor idle container capacity for orchestrator and specialist pools. Warm-pool size is
            derived from fleet worker desired state, so capacity changes belong in worker management.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/config/runtimes">
              Runtime Defaults
              <Settings2 className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/fleet/workers">
              Manage Workers
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      <PoolStateCards status={fleetStatusQuery.data} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {pools.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="py-8 text-center text-muted">
              No pool data available yet. Idle containers appear here when the warm pool is populated.
            </CardContent>
          </Card>
        ) : (
          pools.map((pool) => (
            <Card key={pool.key}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{pool.workerRole}</CardTitle>
                    <CardDescription>{poolLabel(pool.poolKind)}</CardDescription>
                  </div>
                  <PoolBadge poolKind={pool.poolKind} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="rounded-lg border border-border/70 bg-surface/80 p-3">
                    <p className="text-2xl font-bold text-foreground">{pool.idleContainers}</p>
                    <p className="text-xs text-muted">Idle</p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-surface/80 p-3">
                    <p className="text-2xl font-bold text-foreground">{pool.activeContainers}</p>
                    <p className="text-xs text-muted">Active</p>
                  </div>
                </div>
                <p className="text-xs text-muted">
                  To increase or reduce warm capacity for this role, change worker desired state in
                  the fleet worker controls.
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Warm Pool Containers</CardTitle>
          <CardDescription>
            Idle and pre-created containers currently available for faster task pickup.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {warmContainers.length === 0 ? (
            <p className="text-sm text-muted">No idle containers in the warm pool.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Pool</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Image</TableHead>
                  <TableHead>Last Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {warmContainers.map((container) => {
                  const containerId = container.container_id ?? container.id;
                  return (
                    <TableRow key={container.id}>
                      <TableCell className="font-mono text-xs" title={containerId}>
                        {truncateContainerId(containerId)}
                      </TableCell>
                      <TableCell className="font-medium">{container.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{container.worker_role}</Badge>
                      </TableCell>
                      <TableCell>
                        <PoolBadge poolKind={normalizePoolKind(container.pool_kind)} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="warning" className="capitalize">
                          {container.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-xs text-muted">
                        {container.image}
                      </TableCell>
                      <TableCell className="text-muted">
                        {container.last_updated
                          ? new Date(container.last_updated).toLocaleString()
                          : '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
