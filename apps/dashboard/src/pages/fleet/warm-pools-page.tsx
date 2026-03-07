import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Flame, Settings } from 'lucide-react';
import { readSession } from '../../lib/session.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

interface FleetContainer {
  id: string;
  name: string;
  status: string;
  image: string;
  worker_role?: string;
  reuse_count?: number;
  pool_name?: string;
  created_at?: string;
}

interface PoolSummary {
  name: string;
  size: number;
  activeContainers: number;
  reuseCount: number;
  workerRole: string;
}

interface PoolSizeUpdate {
  poolName: string;
  size: number;
}

function normalizeContainers(response: unknown): FleetContainer[] {
  if (Array.isArray(response)) {
    return response as FleetContainer[];
  }
  const wrapped = response as { data?: FleetContainer[] } | undefined;
  return wrapped?.data ?? [];
}

function authHeaders(): Record<string, string> {
  const session = readSession();
  return { Authorization: `Bearer ${session?.accessToken}` };
}

async function fetchContainers(): Promise<FleetContainer[]> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/fleet/containers`, {
    headers: authHeaders(),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return normalizeContainers(await resp.json());
}

function buildPoolSummaries(containers: FleetContainer[]): PoolSummary[] {
  const poolMap = new Map<string, PoolSummary>();

  containers.forEach((container) => {
    const poolName = container.pool_name ?? container.worker_role ?? 'default';
    const existing = poolMap.get(poolName);

    const isIdle = container.status.toLowerCase() === 'idle' || container.status.toLowerCase() === 'created';
    const isActive = container.status.toLowerCase() === 'running';

    if (existing) {
      existing.size += isIdle ? 1 : 0;
      existing.activeContainers += isActive ? 1 : 0;
      existing.reuseCount += container.reuse_count ?? 0;
    } else {
      poolMap.set(poolName, {
        name: poolName,
        size: isIdle ? 1 : 0,
        activeContainers: isActive ? 1 : 0,
        reuseCount: container.reuse_count ?? 0,
        workerRole: container.worker_role ?? 'general',
      });
    }
  });

  return Array.from(poolMap.values());
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

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const parsedSize = parseInt(size, 10);
    if (isNaN(parsedSize) || parsedSize < 0) {
      return;
    }
    resetAndClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) resetAndClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configure Pool Size</DialogTitle>
          <DialogDescription>
            Adjust the warm pool size for &quot;{pool?.name ?? ''}&quot; ({pool?.workerRole ?? ''}).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="pool-size" className="text-sm font-medium">Pool Size</label>
            <Input
              id="pool-size"
              type="number"
              min={0}
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="5"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetAndClose}>Cancel</Button>
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

  const { data: containers, isLoading, error } = useQuery({
    queryKey: ['fleet-containers-warm'],
    queryFn: fetchContainers,
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading warm pool data...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-600">Failed to load warm pool data.</div>;
  }

  const allContainers = containers ?? [];
  const pools = buildPoolSummaries(allContainers);
  const warmContainers = allContainers.filter(
    (c) => c.status.toLowerCase() === 'idle' || c.status.toLowerCase() === 'created',
  );

  function handleConfigurePool(pool: PoolSummary): void {
    setSelectedPool(pool);
    setIsDialogOpen(true);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Flame className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Warm Pools</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pools.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="py-8 text-center text-muted-foreground">
              No pool data available. Containers with idle status appear here as warm pool members.
            </CardContent>
          </Card>
        ) : (
          pools.map((pool) => (
            <Card key={pool.name}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{pool.name}</CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleConfigurePool(pool)}
                    title="Configure pool size"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Role: {pool.workerRole}</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-2xl font-bold">{pool.size}</p>
                    <p className="text-xs text-muted-foreground">Idle</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{pool.activeContainers}</p>
                    <p className="text-xs text-muted-foreground">Active</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{pool.reuseCount}</p>
                    <p className="text-xs text-muted-foreground">Reuses</p>
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
                <TableHead>Pool</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Image</TableHead>
                <TableHead className="text-right">Reuse Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {warmContainers.map((container) => (
                <TableRow key={container.id}>
                  <TableCell className="font-mono text-xs" title={container.id}>
                    {container.id.length > 12 ? `${container.id.slice(0, 12)}...` : container.id}
                  </TableCell>
                  <TableCell className="font-medium">{container.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{container.pool_name ?? container.worker_role ?? 'default'}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="warning" className="capitalize">{container.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{container.image}</TableCell>
                  <TableCell className="text-right">{container.reuse_count ?? 0}</TableCell>
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
