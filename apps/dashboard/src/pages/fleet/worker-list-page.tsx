import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Server,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { dashboardApi, type FleetStatusResponse, type FleetWorkerRecord } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { cn } from '../../lib/utils.js';
import { RelativeTimestamp } from '../../components/operator-display.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { WorkerDesiredStateDialog } from './worker-desired-state-dialog.js';
import { formatCapacityDelta } from './worker-list-page.support.js';

type PoolKind = 'orchestrator' | 'specialist';

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

function describeWorkerAttention(worker: FleetWorkerRecord, runningContainers: number): string {
  if (!worker.enabled) {
    return 'Desired state disabled. This worker stays defined, but orchestration should stop scheduling new work here.';
  }
  if (worker.draining) {
    return 'Drain is active. Existing containers can finish, and new work should route to other workers.';
  }
  if (worker.restart_requested) {
    return 'Restart requested. Watch reconciliation until replacement containers are healthy.';
  }
  if (runningContainers < worker.replicas) {
    return `${formatCapacityDelta(worker.replicas, runningContainers)}. Check docker containers or runtime capacity.`;
  }
  if (runningContainers > worker.replicas) {
    return `${formatCapacityDelta(worker.replicas, runningContainers)}. Wait for reconciliation before forcing action.`;
  }
  return 'Desired capacity and runtime containers are aligned.';
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
  return <Badge variant={poolKind === 'orchestrator' ? 'secondary' : 'outline'}>{poolKind}</Badge>;
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
                <div className="space-y-1">
                  <CardTitle className="text-base">
                    {poolKind === 'orchestrator' ? 'Orchestrator Pool' : 'Specialist Pool'}
                  </CardTitle>
                  <CardDescription>
                    Worker desired state drives warm capacity, running containers, and draining
                    behavior.
                  </CardDescription>
                </div>
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

function WorkerCard({
  worker,
  onEdit,
  onRestart,
  onDrain,
  onDisable,
  pendingAction,
}: {
  worker: FleetWorkerRecord;
  onEdit: () => void;
  onRestart: () => void;
  onDrain: () => void;
  onDisable: () => void;
  pendingAction: 'restart' | 'drain' | 'disable' | null;
}): JSX.Element {
  const runningContainers = worker.actual.filter(
    (instance) => instance.container_status?.toLowerCase() === 'running',
  ).length;
  const workerStatus = buildWorkerStatus(worker);
  const environmentCount = Object.keys(worker.environment ?? {}).length;
  const pinnedModel = worker.llm_model?.trim()
    ? `${worker.llm_provider ?? 'provider'} / ${worker.llm_model}`
    : 'Runtime default';
  const attentionMessage = describeWorkerAttention(worker, runningContainers);
  const isBusy = pendingAction !== null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{worker.worker_name}</CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{worker.role}</span>
              <PoolBadge poolKind={worker.pool_kind} />
              {worker.llm_api_key_secret_ref_configured ? (
                <Badge variant="outline">Secret ref configured</Badge>
              ) : null}
            </div>
          </div>
          <Badge variant={statusVariant(workerStatus)} className="capitalize">
            {workerStatus}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={cn(
            'rounded-lg p-3 text-sm',
            workerStatus === 'online'
              ? 'bg-border/30 text-muted-foreground'
              : 'bg-yellow-100/70 text-yellow-900 dark:bg-yellow-900/25 dark:text-yellow-100',
          )}
        >
          {attentionMessage}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Replicas" value={worker.replicas} />
          <Metric label="Running" value={runningContainers} />
          <Metric label="Actual containers" value={worker.actual.length} />
          <Metric label="Environment vars" value={environmentCount} />
        </div>
        <div className="grid gap-2 text-sm">
          <DetailRow label="Runtime image" value={worker.runtime_image} mono />
          <DetailRow
            label="CPU / Memory"
            value={`${worker.cpu_limit} CPU · ${worker.memory_limit}`}
          />
          <DetailRow label="Network" value={worker.network_policy} />
          <DetailRow label="Model pinning" value={pinnedModel} />
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Updated</span>
            <RelativeTimestamp
              value={worker.updated_at}
              className={cn(worker.enabled ? 'text-foreground' : 'text-muted-foreground')}
            />
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button variant="outline" size="sm" disabled={isBusy || !worker.enabled} onClick={onDrain}>
          <PowerOff className="h-3.5 w-3.5" />
          {pendingAction === 'drain' ? 'Draining…' : 'Drain'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isBusy || !worker.enabled}
          onClick={onRestart}
        >
          <Power className="h-3.5 w-3.5" />
          {pendingAction === 'restart' ? 'Restarting…' : 'Restart'}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={isBusy || !worker.enabled}
          onClick={onDisable}
        >
          {pendingAction === 'disable' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Activity className="h-3.5 w-3.5" />
          )}
          {pendingAction === 'disable' ? 'Disabling…' : 'Disable'}
        </Button>
      </CardFooter>
    </Card>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  valueClassName,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueClassName?: string;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'max-w-[65%] truncate text-right font-medium',
          mono && 'font-mono text-xs',
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function WorkerListPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [selectedWorker, setSelectedWorker] = useState<FleetWorkerRecord | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [workerPendingDisable, setWorkerPendingDisable] = useState<FleetWorkerRecord | null>(null);

  const workersQuery = useQuery({
    queryKey: ['fleet-workers'],
    queryFn: () => dashboardApi.fetchFleetWorkers(),
  });
  const fleetStatusQuery = useQuery({
    queryKey: ['fleet-status'],
    queryFn: () => dashboardApi.fetchFleetStatus(),
  });
  const providersQuery = useQuery({
    queryKey: ['llm-providers'],
    queryFn: () => dashboardApi.listLlmProviders(),
  });
  const modelsQuery = useQuery({
    queryKey: ['llm-models'],
    queryFn: () => dashboardApi.listLlmModels(),
  });

  const restartMutation = useMutation({
    mutationFn: (workerId: string) => dashboardApi.restartFleetWorker(workerId),
    onSuccess: (_, workerId) => {
      void queryClient.invalidateQueries({ queryKey: ['fleet-workers'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-status'] });
      const workerName =
        workersQuery.data?.find((candidate) => candidate.id === workerId)?.worker_name ?? 'Worker';
      toast.success(`${workerName} restart requested`);
    },
    onError: () => {
      toast.error('Failed to request worker restart');
    },
  });
  const drainMutation = useMutation({
    mutationFn: (workerId: string) => dashboardApi.drainFleetWorker(workerId),
    onSuccess: (_, workerId) => {
      void queryClient.invalidateQueries({ queryKey: ['fleet-workers'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-status'] });
      const workerName =
        workersQuery.data?.find((candidate) => candidate.id === workerId)?.worker_name ?? 'Worker';
      toast.success(`${workerName} drain requested`);
    },
    onError: () => {
      toast.error('Failed to request worker drain');
    },
  });
  const disableMutation = useMutation({
    mutationFn: (workerId: string) => dashboardApi.deleteFleetWorker(workerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet-workers'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-status'] });
      toast.success('Worker desired state disabled');
      setWorkerPendingDisable(null);
    },
    onError: () => {
      toast.error('Failed to disable worker desired state');
    },
  });

  if (workersQuery.isLoading || fleetStatusQuery.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-80 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (workersQuery.isError || fleetStatusQuery.isError) {
    return <div className="p-6 text-red-600">Failed to load worker data.</div>;
  }

  const workers = workersQuery.data ?? [];
  const orderedPools: PoolKind[] = ['orchestrator', 'specialist'];
  const modelCatalogError =
    providersQuery.isError || modelsQuery.isError
      ? String(providersQuery.error ?? modelsQuery.error)
      : null;
  const needsAttentionCount = workers.filter((worker) => {
    const runningContainers = worker.actual.filter(
      (instance) => instance.container_status?.toLowerCase() === 'running',
    ).length;
    return (
      !worker.enabled ||
      worker.draining ||
      worker.restart_requested ||
      runningContainers !== worker.replicas
    );
  }).length;
  const activeRestartRequests = workers.filter((worker) => worker.restart_requested).length;
  const disabledWorkers = workers.filter((worker) => !worker.enabled).length;

  function openCreateDialog(): void {
    setDialogMode('create');
    setSelectedWorker(null);
    setIsDialogOpen(true);
  }

  function openEditDialog(worker: FleetWorkerRecord): void {
    setDialogMode('edit');
    setSelectedWorker(worker);
    setIsDialogOpen(true);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Server className="h-6 w-6 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">Workers</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Manage worker desired state for orchestrator and specialist pools in one place. Warm
            pool behavior comes from these worker definitions, and platform-wide runtime caps live
            in runtime defaults.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/config/runtimes">
              Runtime defaults
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            Create worker
          </Button>
        </div>
      </div>

      <WorkerPoolSummaryCards status={fleetStatusQuery.data} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How to use this page</CardTitle>
            <CardDescription>
              Use worker desired state for pool assignment, replicas, runtime image, network
              posture, model pinning, and environment. Use runtime defaults for global runtime caps
              and baseline container defaults.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Model catalog</CardTitle>
            <CardDescription>
              Worker model pinning uses the live provider and model catalog.
              {modelCatalogError
                ? ` Catalog data is temporarily unavailable: ${modelCatalogError}`
                : ' Provider and model selectors are available in the worker editor.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Fleet workers</CardTitle>
            <CardDescription>
              Desired-state entries currently tracked by fleet control.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{workers.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Needs attention</CardTitle>
            <CardDescription>
              Disabled, draining, restarting, or off-target worker entries.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            <p className="text-3xl font-semibold">{needsAttentionCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Action backlog</CardTitle>
            <CardDescription>
              Restart requests and disabled definitions waiting on operator follow-through.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{activeRestartRequests + disabledWorkers}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        {orderedPools.map((poolKind) => {
          const poolWorkers = workers.filter((worker) => worker.pool_kind === poolKind);
          return (
            <section key={poolKind} className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-medium">
                  {poolKind === 'orchestrator' ? 'Orchestrator workers' : 'Specialist workers'}
                </h2>
                <PoolBadge poolKind={poolKind} />
              </div>
              {poolWorkers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No workers configured for this pool.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {poolWorkers.map((worker) => (
                    <WorkerCard
                      key={worker.id}
                      worker={worker}
                      onEdit={() => openEditDialog(worker)}
                      onRestart={() => restartMutation.mutate(worker.id)}
                      onDrain={() => drainMutation.mutate(worker.id)}
                      onDisable={() => setWorkerPendingDisable(worker)}
                      pendingAction={
                        restartMutation.isPending && restartMutation.variables === worker.id
                          ? 'restart'
                          : drainMutation.isPending && drainMutation.variables === worker.id
                            ? 'drain'
                            : disableMutation.isPending && disableMutation.variables === worker.id
                              ? 'disable'
                              : null
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <WorkerDesiredStateDialog
        isOpen={isDialogOpen}
        mode={dialogMode}
        worker={selectedWorker}
        existingWorkers={workers}
        providers={providersQuery.data ?? []}
        models={modelsQuery.data ?? []}
        isModelCatalogLoading={providersQuery.isLoading || modelsQuery.isLoading}
        modelCatalogError={modelCatalogError}
        onClose={() => setIsDialogOpen(false)}
      />

      <Dialog
        open={workerPendingDisable !== null}
        onOpenChange={(open) => (!open ? setWorkerPendingDisable(null) : undefined)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Disable worker desired state</DialogTitle>
            <DialogDescription>
              Stop scheduling new work to this desired-state entry while keeping the historical
              worker record available for inspection.
            </DialogDescription>
          </DialogHeader>
          {workerPendingDisable ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-border/30 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{workerPendingDisable.worker_name}</p>
                <p className="mt-1">
                  Role {workerPendingDisable.role} in the {workerPendingDisable.pool_kind} pool with{' '}
                  {workerPendingDisable.replicas} desired replica
                  {workerPendingDisable.replicas === 1 ? '' : 's'}.
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => setWorkerPendingDisable(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={disableMutation.isPending}
                  onClick={() => disableMutation.mutate(workerPendingDisable.id)}
                >
                  {disableMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Disable worker
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
