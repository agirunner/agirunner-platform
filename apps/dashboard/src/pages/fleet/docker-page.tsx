import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Container, Trash2, Download, ScrollText } from 'lucide-react';
import { dashboardApi, type FleetContainerRecord, type FleetImageRecord } from '../../lib/api.js';
import { ExecutionLogViewer } from '../../components/execution-log-viewer.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog.js';

const CONTAINERS_REFETCH_INTERVAL_MS = 5000;

function truncateId(id: string): string {
  if (id.length <= 12) {
    return id;
  }
  return `${id.slice(0, 12)}...`;
}

function containerStatusVariant(status: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  const normalized = status.toLowerCase();
  if (normalized === 'running') return 'success';
  if (normalized === 'exited' || normalized === 'dead') return 'destructive';
  if (normalized === 'paused' || normalized === 'restarting') return 'warning';
  return 'secondary';
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

  const mutation = useMutation({
    mutationFn: (payload: { repository: string; tag: string }) =>
      dashboardApi.pullFleetImage(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker-images'] });
      resetAndClose();
    },
  });

  function resetAndClose(): void {
    setRepository('');
    setTag('latest');
    onClose();
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!repository.trim()) {
      return;
    }
    mutation.mutate({ repository: repository.trim(), tag: tag.trim() || 'latest' });
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) resetAndClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pull Image</DialogTitle>
          <DialogDescription>Pull a Docker image from a registry.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="pull-repo" className="text-sm font-medium">Repository</label>
            <Input
              id="pull-repo"
              value={repository}
              onChange={(e) => setRepository(e.target.value)}
              placeholder="ghcr.io/org/image"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="pull-tag" className="text-sm font-medium">Tag</label>
            <Input
              id="pull-tag"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="latest"
            />
          </div>
          {mutation.isError && (
            <p className="text-sm text-red-600">Failed to pull image. Check repository and try again.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetAndClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Pulling...' : 'Pull'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContainersTab(): JSX.Element {
  const queryClient = useQueryClient();
  const [logContainerId, setLogContainerId] = useState<string | null>(null);

  const { data: containers, isLoading, error } = useQuery<FleetContainerRecord[]>({
    queryKey: ['docker-containers'],
    queryFn: () => dashboardApi.fetchFleetContainers(),
    refetchInterval: CONTAINERS_REFETCH_INTERVAL_MS,
  });

  const pruneMutation = useMutation({
    mutationFn: () => dashboardApi.pruneFleetContainers(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker-containers'] });
    },
  });

  if (isLoading) {
    return <p className="py-4 text-muted-foreground">Loading containers...</p>;
  }

  if (error) {
    return <p className="py-4 text-red-600">Failed to load containers.</p>;
  }

  const items = containers ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{items.length} container(s) — auto-refreshes every 5s</p>
        <Button
          variant="destructive"
          size="sm"
          disabled={pruneMutation.isPending}
          onClick={() => pruneMutation.mutate()}
        >
          <Trash2 className="h-4 w-4" />
          {pruneMutation.isPending ? 'Pruning...' : 'Prune Stale'}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground">No containers found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Container ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Image</TableHead>
              <TableHead className="text-right">CPU %</TableHead>
              <TableHead className="text-right">Memory (MB)</TableHead>
              <TableHead>Last Updated</TableHead>
              <TableHead className="w-[80px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((container) => (
              <TableRow key={container.id}>
                <TableCell className="font-mono text-xs" title={container.container_id ?? container.id}>
                  {truncateId(container.container_id ?? container.id)}
                </TableCell>
                <TableCell className="font-medium">{container.name}</TableCell>
                <TableCell>
                  <Badge variant={containerStatusVariant(container.status)} className="capitalize">
                    {container.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">{container.image}</TableCell>
                <TableCell className="text-right">
                  {container.cpu_usage_percent != null ? container.cpu_usage_percent.toFixed(1) : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {container.memory_usage_bytes != null
                    ? (container.memory_usage_bytes / (1024 * 1024)).toFixed(0)
                    : '-'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {container.last_updated ? new Date(container.last_updated).toLocaleString() : '-'}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    title="View logs"
                    onClick={() => setLogContainerId(container.container_id ?? container.id)}
                  >
                    <ScrollText className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {logContainerId && (
        <Dialog open onOpenChange={(open) => { if (!open) setLogContainerId(null); }}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Container Logs</DialogTitle>
              <DialogDescription>
                Streaming logs for container {truncateId(logContainerId)}
              </DialogDescription>
            </DialogHeader>
            <ExecutionLogViewer sseUrl={`/api/v1/fleet/containers/${logContainerId}/logs/stream`} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ImagesTab(): JSX.Element {
  const [isPullOpen, setIsPullOpen] = useState(false);

  const { data: images, isLoading, error } = useQuery<FleetImageRecord[]>({
    queryKey: ['docker-images'],
    queryFn: () => dashboardApi.fetchFleetImages(),
  });

  if (isLoading) {
    return <p className="py-4 text-muted-foreground">Loading images...</p>;
  }

  if (error) {
    return <p className="py-4 text-red-600">Failed to load images.</p>;
  }

  const items = images ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{items.length} image(s)</p>
        <Button size="sm" onClick={() => setIsPullOpen(true)}>
          <Download className="h-4 w-4" />
          Pull Image
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground">No images found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Repository</TableHead>
              <TableHead>Tag</TableHead>
              <TableHead>Digest</TableHead>
              <TableHead className="text-right">Size (MB)</TableHead>
              <TableHead>Last Seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((image, idx) => (
              <TableRow key={`${image.repository}:${image.tag}-${idx}`}>
                <TableCell className="font-medium">{image.repository}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{image.tag ?? 'latest'}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground" title={image.digest ?? undefined}>
                  {truncateId(image.digest ?? '')}
                </TableCell>
                <TableCell className="text-right">
                  {image.size_bytes != null ? (image.size_bytes / (1024 * 1024)).toFixed(1) : '-'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {image.last_seen ? new Date(image.last_seen).toLocaleString() : '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <PullImageDialog isOpen={isPullOpen} onClose={() => setIsPullOpen(false)} />
    </div>
  );
}

export function DockerPage(): JSX.Element {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Container className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Docker Management</h1>
      </div>

      <Tabs defaultValue="containers">
        <TabsList>
          <TabsTrigger value="containers">Containers</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
        </TabsList>
        <TabsContent value="containers">
          <ContainersTab />
        </TabsContent>
        <TabsContent value="images">
          <ImagesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
