import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Container, Download, HardDrive, Loader2, ScrollText, Trash2 } from 'lucide-react';

import {
  CopyableIdBadge,
  RelativeTimestamp,
  summarizeDisplayId,
} from '../../components/operator-display.js';
import { ExecutionLogViewer } from '../../components/execution-log-viewer.js';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { dashboardApi, type FleetContainerRecord, type FleetImageRecord } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';

const CONTAINERS_REFETCH_INTERVAL_MS = 5000;

function formatMemoryUsage(value: number | null): string {
  if (value == null) {
    return '-';
  }
  return `${(value / (1024 * 1024)).toFixed(0)} MB`;
}

function formatImageSize(value: number | null): string {
  if (value == null) {
    return '-';
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function containerStatusVariant(
  status: string,
): 'success' | 'destructive' | 'warning' | 'secondary' {
  const normalized = status.toLowerCase();
  if (normalized === 'running') {
    return 'success';
  }
  if (normalized === 'exited' || normalized === 'dead') {
    return 'destructive';
  }
  if (normalized === 'paused' || normalized === 'restarting') {
    return 'warning';
  }
  return 'secondary';
}

function SummaryCard({
  title,
  description,
  value,
}: {
  title: string;
  description: string;
  value: string | number;
}): JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function PullImageDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [repository, setRepository] = useState('');
  const [tag, setTag] = useState('latest');

  const repositoryError =
    repository.trim().length > 0 ? null : 'Enter the registry repository to pull.';
  const mutation = useMutation({
    mutationFn: (payload: { repository: string; tag: string }) =>
      dashboardApi.pullFleetImage(payload),
    onSuccess: (_, payload) => {
      void queryClient.invalidateQueries({ queryKey: ['docker-images'] });
      toast.success(`Pull started for ${payload.repository}:${payload.tag}`);
      resetAndClose();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    },
  });

  function resetAndClose(): void {
    setRepository('');
    setTag('latest');
    onClose();
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (repositoryError) {
      return;
    }
    mutation.mutate({
      repository: repository.trim(),
      tag: tag.trim() || 'latest',
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (!open ? resetAndClose() : undefined)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Pull Docker image</DialogTitle>
          <DialogDescription>
            Stage a runtime image before workers or warm pools depend on it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 rounded-lg bg-border/30 p-4 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                Repository
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {repository.trim() || 'ghcr.io/org/image'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                Tag
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">{tag.trim() || 'latest'}</p>
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="pull-repository" className="text-sm font-medium">
              Repository
            </label>
            <Input
              id="pull-repository"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              placeholder="ghcr.io/org/runtime"
              aria-invalid={repositoryError ? 'true' : 'false'}
            />
            {repositoryError ? (
              <p className="text-xs text-red-600">{repositoryError}</p>
            ) : (
              <p className="text-xs text-muted">
                Use the full registry path operators expect to see in worker desired state.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="pull-tag" className="text-sm font-medium">
              Tag
            </label>
            <Input
              id="pull-tag"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              placeholder="latest"
            />
            <p className="text-xs text-muted">
              Leave this as `latest` only if your operator workflow explicitly tolerates mutable
              tags.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || repositoryError !== null}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mutation.isPending ? 'Pulling…' : 'Pull image'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContainersTab(): JSX.Element {
  const queryClient = useQueryClient();
  const [selectedContainer, setSelectedContainer] = useState<FleetContainerRecord | null>(null);
  const [isPruneConfirmOpen, setIsPruneConfirmOpen] = useState(false);

  const {
    data: containers,
    isLoading,
    error,
  } = useQuery<FleetContainerRecord[]>({
    queryKey: ['docker-containers'],
    queryFn: () => dashboardApi.fetchFleetContainers(),
    refetchInterval: CONTAINERS_REFETCH_INTERVAL_MS,
  });
  const pruneMutation = useMutation({
    mutationFn: () => dashboardApi.pruneFleetContainers(),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['docker-containers'] });
      setIsPruneConfirmOpen(false);
      toast.success(`Pruned ${result.removed} stale container${result.removed === 1 ? '' : 's'}`);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    },
  });

  if (isLoading) {
    return <p className="py-4 text-muted-foreground">Loading containers…</p>;
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Container inventory unavailable</CardTitle>
          <CardDescription>
            The docker surface could not load runtime containers. Refresh the page or check fleet
            connectivity.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const items = containers ?? [];
  const runningCount = items.filter(
    (container) => container.status.toLowerCase() === 'running',
  ).length;
  const attentionCount = items.filter((container) =>
    ['dead', 'exited', 'restarting'].includes(container.status.toLowerCase()),
  ).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          title="Containers"
          description="Docker-backed runtime instances tracked in fleet control."
          value={items.length}
        />
        <SummaryCard
          title="Running"
          description="Containers currently serving runtime work."
          value={runningCount}
        />
        <SummaryCard
          title="Needs attention"
          description="Exited, dead, or restarting containers worth operator follow-up."
          value={attentionCount}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Runtime containers</CardTitle>
            <CardDescription>
              Auto-refreshes every 5 seconds so operators can verify reconciliation without leaving
              the page.
            </CardDescription>
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={pruneMutation.isPending || items.length === 0}
            onClick={() => setIsPruneConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            Prune exited containers
          </Button>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="rounded-lg bg-border/30 p-6 text-sm text-muted-foreground">
              No containers are currently present. Pull an image or enable worker desired state to
              repopulate the runtime fleet.
            </div>
          ) : (
            <>
              <div className="space-y-3 lg:hidden">
                {items.map((container) => (
                  <Card key={container.id}>
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <CardTitle className="text-base">{container.name}</CardTitle>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={containerStatusVariant(container.status)}
                              className="capitalize"
                            >
                              {container.status}
                            </Badge>
                            <Badge variant="outline">{container.pool_kind ?? 'unassigned'}</Badge>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedContainer(container)}
                        >
                          <ScrollText className="h-4 w-4" />
                          View logs
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <CopyableIdBadge value={container.container_id ?? container.id} label="ID" />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-muted">
                            Worker role
                          </p>
                          <p className="mt-1 font-medium text-foreground">
                            {container.worker_role}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-muted">
                            CPU / memory
                          </p>
                          <p className="mt-1 font-medium text-foreground">
                            {container.cpu_usage_percent != null
                              ? `${container.cpu_usage_percent.toFixed(1)}%`
                              : '-'}{' '}
                            • {formatMemoryUsage(container.memory_usage_bytes)}
                          </p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-muted">Image</p>
                        <p className="mt-1 break-all font-mono text-xs text-foreground">
                          {container.image}
                        </p>
                      </div>
                      <RelativeTimestamp value={container.last_updated} prefix="Updated" />
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Container</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Image</TableHead>
                      <TableHead className="text-right">CPU</TableHead>
                      <TableHead className="text-right">Memory</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((container) => (
                      <TableRow key={container.id}>
                        <TableCell>
                          <div className="space-y-2">
                            <p className="font-medium">{container.name}</p>
                            <CopyableIdBadge
                              value={container.container_id ?? container.id}
                              label="ID"
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={containerStatusVariant(container.status)}
                              className="capitalize"
                            >
                              {container.status}
                            </Badge>
                            <Badge variant="outline">{container.pool_kind ?? 'unassigned'}</Badge>
                          </div>
                        </TableCell>
                        <TableCell>{container.worker_role}</TableCell>
                        <TableCell className="max-w-sm">
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {container.image}
                          </p>
                        </TableCell>
                        <TableCell className="text-right">
                          {container.cpu_usage_percent != null
                            ? `${container.cpu_usage_percent.toFixed(1)}%`
                            : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMemoryUsage(container.memory_usage_bytes)}
                        </TableCell>
                        <TableCell>
                          <RelativeTimestamp value={container.last_updated} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedContainer(container)}
                          >
                            <ScrollText className="h-4 w-4" />
                            View logs
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={selectedContainer !== null}
        onOpenChange={(open) => (!open ? setSelectedContainer(null) : undefined)}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          {selectedContainer ? (
            <>
              <DialogHeader>
                <DialogTitle>{selectedContainer.name} logs</DialogTitle>
                <DialogDescription>
                  Follow live docker output for this container while you verify worker health or
                  image rollout.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 rounded-lg bg-border/30 p-4 sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                    Status
                  </p>
                  <Badge
                    variant={containerStatusVariant(selectedContainer.status)}
                    className="mt-2 w-fit capitalize"
                  >
                    {selectedContainer.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                    Worker role
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {selectedContainer.worker_role}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                    Updated
                  </p>
                  <RelativeTimestamp
                    value={selectedContainer.last_updated}
                    className="mt-1 block"
                  />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                    Container ID
                  </p>
                  <div className="mt-1">
                    <CopyableIdBadge
                      value={selectedContainer.container_id ?? selectedContainer.id}
                    />
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border">
                <ExecutionLogViewer
                  sseUrl={`/api/v1/fleet/containers/${selectedContainer.container_id ?? selectedContainer.id}/logs/stream`}
                />
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={isPruneConfirmOpen} onOpenChange={setIsPruneConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Prune exited containers</DialogTitle>
            <DialogDescription>
              Remove stale docker containers that are no longer serving work. Running containers are
              left alone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-border/30 p-4 text-sm text-muted-foreground">
              This action is best used after drain or restart activity when exited containers are
              cluttering the operator view.
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setIsPruneConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={pruneMutation.isPending}
                onClick={() => pruneMutation.mutate()}
              >
                {pruneMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Prune exited containers
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ImagesTab(): JSX.Element {
  const [isPullOpen, setIsPullOpen] = useState(false);
  const {
    data: images,
    isLoading,
    error,
  } = useQuery<FleetImageRecord[]>({
    queryKey: ['docker-images'],
    queryFn: () => dashboardApi.fetchFleetImages(),
  });

  if (isLoading) {
    return <p className="py-4 text-muted-foreground">Loading images…</p>;
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Image inventory unavailable</CardTitle>
          <CardDescription>
            The docker image registry view failed to load. Refresh the page or retry after fleet
            connectivity recovers.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const items = images ?? [];
  const totalSize = items.reduce((sum, image) => sum + (image.size_bytes ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          title="Images"
          description="Runtime image references available to the fleet."
          value={items.length}
        />
        <SummaryCard
          title="Unique repositories"
          description="Distinct registries or repositories represented in the local cache."
          value={new Set(items.map((image) => image.repository)).size}
        />
        <SummaryCard
          title="Cached size"
          description="Approximate disk footprint of images currently tracked."
          value={formatImageSize(totalSize)}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Pulled images</CardTitle>
            <CardDescription>
              Check tag freshness here before pinning worker desired state to a runtime image.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setIsPullOpen(true)}>
            <Download className="h-4 w-4" />
            Pull image
          </Button>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="rounded-lg bg-border/30 p-6 text-sm text-muted-foreground">
              No images are cached yet. Pull a runtime image before assigning it to workers.
            </div>
          ) : (
            <>
              <div className="space-y-3 lg:hidden">
                {items.map((image, index) => (
                  <Card key={`${image.repository}:${image.tag ?? 'latest'}-${index}`}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <CardTitle className="text-base break-all">{image.repository}</CardTitle>
                          <Badge variant="secondary">{image.tag ?? 'latest'}</Badge>
                        </div>
                        <HardDrive className="h-5 w-5 text-muted-foreground" />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-muted">Digest</p>
                        <p className="mt-1 font-mono text-xs text-foreground">
                          {image.digest ? summarizeDisplayId(image.digest) : '-'}
                        </p>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-muted">Size</p>
                          <p className="mt-1 font-medium text-foreground">
                            {formatImageSize(image.size_bytes)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-muted">
                            Last seen
                          </p>
                          <RelativeTimestamp value={image.last_seen} className="mt-1 block" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Repository</TableHead>
                      <TableHead>Tag</TableHead>
                      <TableHead>Digest</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead>Last seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((image, index) => (
                      <TableRow key={`${image.repository}:${image.tag ?? 'latest'}-${index}`}>
                        <TableCell className="font-medium">{image.repository}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{image.tag ?? 'latest'}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {image.digest ? summarizeDisplayId(image.digest) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatImageSize(image.size_bytes)}
                        </TableCell>
                        <TableCell>
                          <RelativeTimestamp value={image.last_seen} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <PullImageDialog isOpen={isPullOpen} onClose={() => setIsPullOpen(false)} />
    </div>
  );
}

export function DockerPage(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Container className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Docker management</h1>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Inspect worker runtime containers, confirm image availability, and open logs without
          leaving fleet operations.
        </p>
      </div>

      <Tabs defaultValue="containers">
        <TabsList className="h-auto w-full flex-wrap">
          <TabsTrigger value="containers" className="flex-1 min-w-[160px]">
            Containers
          </TabsTrigger>
          <TabsTrigger value="images" className="flex-1 min-w-[160px]">
            Images
          </TabsTrigger>
        </TabsList>
        <TabsContent value="containers" className="mt-4">
          <ContainersTab />
        </TabsContent>
        <TabsContent value="images" className="mt-4">
          <ImagesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
