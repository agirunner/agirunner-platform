import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Plus, Power, PowerOff, Server, Trash2 } from 'lucide-react';

import {
  dashboardApi,
  type FleetStatusResponse,
  type FleetWorkerRecord,
} from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { Skeleton } from '../../components/ui/skeleton.js';

type PoolKind = 'orchestrator' | 'specialist';

interface RegisterWorkerPayload {
  name: string;
  role: string;
  runtimeImage: string;
}

const STATUS_VARIANT: Record<string, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  online: 'success',
  offline: 'destructive',
  degraded: 'warning',
  busy: 'secondary',
  configured: 'secondary',
  disabled: 'warning',
};

function statusVariant(status: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  return STATUS_VARIANT[status.toLowerCase()] ?? 'secondary';
}

function inferPoolKindFromRole(role: string): PoolKind {
  return role.toLowerCase().includes('orchestrator') ? 'orchestrator' : 'specialist';
}

function formatHeartbeat(timestamp: string | null): string {
  if (!timestamp) {
    return 'No runtime heartbeat';
  }
  return new Date(timestamp).toLocaleString();
}

function buildWorkerStatus(worker: FleetWorkerRecord): string {
  if (!worker.enabled) {
    return 'disabled';
  }
  if (worker.draining) {
    return 'degraded';
  }
  if (worker.actual.some((instance) => instance.container_status?.toLowerCase() === 'running')) {
    return 'online';
  }
  return 'configured';
}

function Metric({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function PoolBadge({ poolKind }: { poolKind: PoolKind }): JSX.Element {
  return (
    <Badge variant={poolKind === 'orchestrator' ? 'secondary' : 'outline'}>{poolKind}</Badge>
  );
}

function WorkerPoolSummaryCards({
  status,
}: {
  status: FleetStatusResponse | undefined;
}): JSX.Element | null {
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
                <CardTitle className="text-base">
                  {poolKind === 'orchestrator' ? 'Orchestrator Pool' : 'Specialist Pool'}
                </CardTitle>
                <PoolBadge poolKind={poolKind} />
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Desired replicas" value={pool?.desired_replicas ?? 0} />
              <Metric label="Enabled workers" value={pool?.enabled_workers ?? 0} />
              <Metric label="Running" value={pool?.running_containers ?? 0} />
              <Metric label="Draining" value={pool?.draining_workers ?? 0} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function RegisterWorkerDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [runtimeImage, setRuntimeImage] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: RegisterWorkerPayload) =>
      dashboardApi.createFleetWorker({
        workerName: payload.name,
        role: payload.role,
        poolKind: inferPoolKindFromRole(payload.role),
        runtimeImage: payload.runtimeImage,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet-workers'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-status'] });
      resetAndClose();
    },
  });

  function resetAndClose(): void {
    setName('');
    setRole('');
    setRuntimeImage('');
    onClose();
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (!name.trim() || !role.trim() || !runtimeImage.trim()) {
      return;
    }
    mutation.mutate({
      name: name.trim(),
      role: role.trim(),
      runtimeImage: runtimeImage.trim(),
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (!open ? resetAndClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register Fleet Worker</DialogTitle>
          <DialogDescription>
            Add a worker desired-state entry in the orchestrator or specialist pool.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="worker-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="worker-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="worker-orchestrator-01"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="worker-role" className="text-sm font-medium">
              Role
            </label>
            <Input
              id="worker-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="orchestrator"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="worker-image" className="text-sm font-medium">
              Runtime Image
            </label>
            <Input
              id="worker-image"
              value={runtimeImage}
              onChange={(event) => setRuntimeImage(event.target.value)}
              placeholder="ghcr.io/agirunner/runtime:latest"
            />
          </div>
          {mutation.isError ? (
            <p className="text-sm text-red-600">Failed to register worker.</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Registering...' : 'Register'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WorkerGrid({ workers }: { workers: FleetWorkerRecord[] }): JSX.Element {
  const orderedPools: PoolKind[] = ['orchestrator', 'specialist'];
  const queryClient = useQueryClient();

  const drainMutation = useMutation({
    mutationFn: (workerId: string) => dashboardApi.drainFleetWorker(workerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet-workers'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-status'] });
    },
  });
  const restartMutation = useMutation({
    mutationFn: (workerId: string) => dashboardApi.restartFleetWorker(workerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet-workers'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-status'] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (workerId: string) => dashboardApi.deleteFleetWorker(workerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet-workers'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-status'] });
      toast.success('Worker deleted');
    },
    onError: () => {
      toast.error('Failed to delete worker');
    },
  });

  return (
    <div className="space-y-6">
      {orderedPools.map((poolKind) => {
        const poolWorkers = workers.filter((worker) => worker.pool_kind === poolKind);
        return (
          <section key={poolKind} className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-medium">
                {poolKind === 'orchestrator' ? 'Orchestrator Workers' : 'Specialist Workers'}
              </h2>
              <PoolBadge poolKind={poolKind} />
            </div>
            {poolWorkers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workers configured for this pool.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {poolWorkers.map((worker) => {
                  const runningContainers = worker.actual.filter(
                    (instance) => instance.container_status?.toLowerCase() === 'running',
                  ).length;
                  const totalTasks = worker.actual.filter(
                    (instance) => instance.container_status?.toLowerCase() === 'running',
                  ).length;
                  const workerStatus = buildWorkerStatus(worker);
                  return (
                    <Card key={worker.id}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">{worker.worker_name}</CardTitle>
                          <Badge variant={statusVariant(workerStatus)} className="capitalize">
                            {workerStatus}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{worker.role}</span>
                          <PoolBadge poolKind={worker.pool_kind} />
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <Metric label="Replicas" value={worker.replicas} />
                          <Metric label="Running" value={runningContainers} />
                          <Metric label="Actual" value={worker.actual.length} />
                          <Metric label="Tasks" value={totalTasks} />
                        </div>
                        <div className="space-y-1 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Model</span>
                            <span className="font-medium">{worker.llm_model ?? 'Unpinned'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Runtime</span>
                            <span className="max-w-[65%] truncate text-right font-medium">
                              {worker.runtime_image}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Last update</span>
                            <span className={cn('text-right', worker.enabled ? 'text-foreground' : 'text-muted-foreground')}>
                              {formatHeartbeat(worker.updated_at)}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                      <CardFooter className="gap-2 border-t border-border pt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={drainMutation.isPending}
                          onClick={() => drainMutation.mutate(worker.id)}
                        >
                          <PowerOff className="h-3.5 w-3.5" />
                          Drain
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={restartMutation.isPending}
                          onClick={() => restartMutation.mutate(worker.id)}
                        >
                          <Power className="h-3.5 w-3.5" />
                          Restart
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(worker.id)}
                          data-testid={`delete-worker-${worker.worker_name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function WorkerListPage(): JSX.Element {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const workersQuery = useQuery({
    queryKey: ['fleet-workers'],
    queryFn: () => dashboardApi.fetchFleetWorkers(),
  });
  const fleetStatusQuery = useQuery({
    queryKey: ['fleet-status'],
    queryFn: () => dashboardApi.fetchFleetStatus(),
  });

  const isLoading = workersQuery.isLoading || fleetStatusQuery.isLoading;
  const hasError = workersQuery.isError || fleetStatusQuery.isError;

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (hasError) {
    return <div className="p-6 text-red-600">Failed to load worker data.</div>;
  }

  const workers = workersQuery.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Workers</h1>
        </div>
        <Button onClick={() => setIsDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Register Worker
        </Button>
      </div>

      <WorkerPoolSummaryCards status={fleetStatusQuery.data} />

      {workers.length === 0 ? (
        <p className="text-muted-foreground">No workers registered.</p>
      ) : (
        <WorkerGrid workers={workers} />
      )}

      <RegisterWorkerDialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} />
    </div>
  );
}
