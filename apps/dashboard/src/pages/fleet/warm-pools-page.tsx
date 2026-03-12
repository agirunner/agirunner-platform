import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Flame, Settings } from 'lucide-react';

import {
  dashboardApi,
  type FleetContainerRecord,
  type FleetStatusResponse,
} from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
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
  size: number;
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
    const isIdle = ['idle', 'created'].includes(container.status.toLowerCase());
    const isActive = container.status.toLowerCase() === 'running';

    if (current) {
      current.size += isIdle ? 1 : 0;
      current.activeContainers += isActive ? 1 : 0;
      continue;
    }

    pools.set(key, {
      key,
      workerRole: container.worker_role,
      poolKind,
      size: isIdle ? 1 : 0,
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
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{poolLabel(poolKind)}</CardTitle>
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

function PoolMetric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function PoolSizeDialog({
  isOpen,
  onClose,
  pool,
}: {
  isOpen: boolean;
  onClose: () => void;
  pool: PoolSummary | null;
}): JSX.Element {
  const [size, setSize] = useState(pool?.size.toString() ?? '');

  function resetAndClose(): void {
    setSize('');
    onClose();
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    const parsed = Number.parseInt(size, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      return;
    }
    resetAndClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (!open ? resetAndClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configure Pool Size</DialogTitle>
          <DialogDescription>
            Adjust the warm pool size for {pool?.workerRole ?? ''} in the{' '}
            {pool ? poolLabel(pool.poolKind).toLowerCase() : 'selected pool'}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="pool-size" className="text-sm font-medium">
              Pool Size
            </label>
            <Input
              id="pool-size"
              type="number"
              min={0}
              value={size}
              onChange={(event) => setSize(event.target.value)}
              placeholder="5"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WarmPoolsPage(): JSX.Element {
  const [selectedPool, setSelectedPool] = useState<PoolSummary | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const containersQuery = useQuery({
    queryKey: ['fleet-containers-warm'],
    queryFn: () => dashboardApi.fetchFleetContainers(),
  });
  const fleetStatusQuery = useQuery({
    queryKey: ['fleet-status'],
    queryFn: () => dashboardApi.fetchFleetStatus(),
  });

  if (containersQuery.isLoading) {
    return <div className="p-6 text-muted-foreground">Loading warm pool data...</div>;
  }

  if (containersQuery.error) {
    return <div className="p-6 text-red-600">Failed to load warm pool data.</div>;
  }

  const containers = containersQuery.data ?? [];
  const pools = buildPoolSummaries(containers);
  const warmContainers = containers.filter((container) =>
    ['idle', 'created'].includes(container.status.toLowerCase()),
  );

  function handleConfigurePool(pool: PoolSummary): void {
    setSelectedPool(pool);
    setIsDialogOpen(true);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-2">
        <Flame className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Warm Pools</h1>
      </div>

      <PoolStateCards status={fleetStatusQuery.data} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {pools.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="py-8 text-center text-muted-foreground">
              No pool data available. Idle containers appear here when the warm pool is populated.
            </CardContent>
          </Card>
        ) : (
          pools.map((pool) => (
            <Card key={pool.key}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{pool.workerRole}</CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleConfigurePool(pool)}
                    title="Configure pool size"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{poolLabel(pool.poolKind)}</span>
                  <PoolBadge poolKind={pool.poolKind} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div>
                    <p className="text-2xl font-bold">{pool.size}</p>
                    <p className="text-xs text-muted-foreground">Idle</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{pool.activeContainers}</p>
                    <p className="text-xs text-muted-foreground">Active</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-medium">Warm Pool Containers</h2>
        {warmContainers.length === 0 ? (
          <p className="text-muted-foreground">No idle containers in the warm pool.</p>
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
              {warmContainers.map((container) => (
                <TableRow key={container.id}>
                  <TableCell className="font-mono text-xs" title={container.container_id ?? container.id}>
                    {(container.container_id ?? container.id).length > 12
                      ? `${(container.container_id ?? container.id).slice(0, 12)}...`
                      : container.container_id ?? container.id}
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
                  <TableCell className="text-xs text-muted-foreground">{container.image}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {container.last_updated ? new Date(container.last_updated).toLocaleString() : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <PoolSizeDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        pool={selectedPool}
      />
    </div>
  );
}
