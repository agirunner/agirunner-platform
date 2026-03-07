import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  Loader2,
  CheckCircle,
  XCircle,
  RotateCcw,
  Clock,
  DollarSign,
  User,
  Cpu,
  Workflow,
  Download,
} from 'lucide-react';
import { dashboardApi, type DashboardTaskArtifactRecord, type DashboardEventRecord } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../../components/ui/tabs.js';

interface Task {
  id: string;
  name?: string;
  title?: string;
  status: string;
  state?: string;
  role?: string;
  agent_id?: string;
  agent_name?: string;
  assigned_worker?: string;
  worker_id?: string;
  workflow_id?: string;
  workflow_name?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  cost?: number;
  output?: unknown;
  description?: string;
}

function normalizeTask(response: unknown): Task {
  const wrapped = response as { data?: unknown };
  if (wrapped?.data && typeof wrapped.data === 'object' && 'id' in (wrapped.data as object)) {
    return wrapped.data as Task;
  }
  return response as Task;
}

function resolveStatus(task: Task): string {
  return (task.status ?? task.state ?? 'unknown').toLowerCase();
}

function statusBadgeVariant(status: string) {
  const map: Record<string, 'success' | 'default' | 'destructive' | 'warning' | 'secondary'> = {
    completed: 'success',
    running: 'default',
    failed: 'destructive',
    paused: 'warning',
    pending: 'secondary',
    awaiting_approval: 'warning',
  };
  return map[status] ?? 'secondary';
}

function formatTimestamp(value?: string): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function formatDuration(task: Task): string {
  if (task.duration_seconds !== undefined && task.duration_seconds !== null) {
    const s = task.duration_seconds;
    if (s < 60) return `${Math.round(s)}s`;
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  }
  if (!task.started_at) return '-';
  const start = new Date(task.started_at).getTime();
  const end = task.completed_at ? new Date(task.completed_at).getTime() : Date.now();
  const seconds = (end - start) / 1000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <p className="mt-1 text-sm font-medium">{value}</p>
      </CardContent>
    </Card>
  );
}

function TaskActionButtons({ task }: { task: Task }): JSX.Element {
  const queryClient = useQueryClient();
  const status = resolveStatus(task);
  const isAwaitingApproval = status === 'awaiting_approval';
  const isFailed = status === 'failed';
  const isRunning = status === 'running';

  const approveMutation = useMutation({
    mutationFn: () => dashboardApi.approveTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => dashboardApi.rejectTask(task.id, { feedback: 'Rejected from dashboard' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => dashboardApi.retryTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => dashboardApi.cancelTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const isActionPending =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    retryMutation.isPending ||
    cancelMutation.isPending;

  return (
    <div className="flex gap-2">
      {isAwaitingApproval && (
        <>
          <Button
            size="sm"
            disabled={isActionPending}
            onClick={() => approveMutation.mutate()}
          >
            <CheckCircle className="h-4 w-4" />
            Approve
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={isActionPending}
            onClick={() => rejectMutation.mutate()}
          >
            <XCircle className="h-4 w-4" />
            Reject
          </Button>
        </>
      )}
      {isFailed && (
        <Button
          variant="outline"
          size="sm"
          disabled={isActionPending}
          onClick={() => retryMutation.mutate()}
        >
          <RotateCcw className="h-4 w-4" />
          Retry
        </Button>
      )}
      {isRunning && (
        <Button
          variant="destructive"
          size="sm"
          disabled={isActionPending}
          onClick={() => cancelMutation.mutate()}
        >
          <XCircle className="h-4 w-4" />
          Cancel
        </Button>
      )}
    </div>
  );
}

function OutputSection({ output }: { output: unknown }): JSX.Element {
  if (output === undefined || output === null) {
    return <p className="text-sm text-muted">No output available.</p>;
  }

  const formatted = typeof output === 'string' ? output : JSON.stringify(output, null, 2);

  return (
    <pre className="overflow-x-auto rounded-md border bg-border/10 p-4 text-xs">
      <code>{formatted}</code>
    </pre>
  );
}

function EventLog({ taskId }: { taskId: string }): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['events', 'task', taskId],
    queryFn: () => dashboardApi.listEvents({ entity_type: 'task', entity_id: taskId }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading events...
      </div>
    );
  }

  const events: DashboardEventRecord[] = data?.data ?? [];

  if (events.length === 0) {
    return <p className="text-sm text-muted">No execution events recorded.</p>;
  }

  return (
    <div className="space-y-2">
      {events.map((event) => (
        <div key={event.id} className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-medium capitalize">{event.type.replace(/_/g, ' ')}</p>
            <p className="text-xs text-muted">{new Date(event.created_at).toLocaleString()}</p>
            {event.data && Object.keys(event.data).length > 0 && (
              <pre className="mt-1 overflow-x-auto text-xs text-muted">
                {JSON.stringify(event.data, null, 2)}
              </pre>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ArtifactList({ taskId }: { taskId: string }): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['task-artifacts', taskId],
    queryFn: () => dashboardApi.listTaskArtifacts(taskId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading artifacts...
      </div>
    );
  }

  const artifacts: DashboardTaskArtifactRecord[] = data ?? [];

  if (artifacts.length === 0) {
    return <p className="text-sm text-muted">No artifacts produced by this task.</p>;
  }

  return (
    <div className="space-y-2">
      {artifacts.map((artifact) => (
        <div
          key={artifact.id}
          className="flex items-center justify-between rounded-md border p-3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{artifact.logical_path}</p>
            <p className="text-xs text-muted">
              {artifact.content_type} &middot; {formatFileSize(artifact.size_bytes)}
            </p>
          </div>
          <a
            href={artifact.download_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="ghost" size="sm">
              <Download className="h-4 w-4" />
            </Button>
          </a>
        </div>
      ))}
    </div>
  );
}

export function TaskDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['task', id],
    queryFn: () => dashboardApi.getTask(id!),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-red-600">Failed to load task. Please try again later.</div>
    );
  }

  const task = normalizeTask(data);
  const status = resolveStatus(task);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{task.title ?? task.name ?? task.id}</h1>
          <Badge variant={statusBadgeVariant(status)} className="capitalize">
            {status.replace(/_/g, ' ')}
          </Badge>
        </div>
        <TaskActionButtons task={task} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <InfoCard
          icon={User}
          label="Assigned Agent"
          value={task.agent_name ?? task.agent_id ?? 'Unassigned'}
        />
        <InfoCard
          icon={Cpu}
          label="Worker"
          value={task.assigned_worker ?? task.worker_id ?? 'Unassigned'}
        />
        <InfoCard
          icon={Workflow}
          label="Workflow"
          value={task.workflow_name ?? task.workflow_id ?? '-'}
        />
        <InfoCard icon={User} label="Role" value={task.role ?? '-'} />
        <InfoCard icon={Clock} label="Created" value={formatTimestamp(task.created_at)} />
        <InfoCard icon={Clock} label="Started" value={formatTimestamp(task.started_at)} />
        <InfoCard icon={Clock} label="Completed" value={formatTimestamp(task.completed_at)} />
        <InfoCard
          icon={DollarSign}
          label="Cost"
          value={
            task.cost !== undefined && task.cost !== null ? `$${task.cost.toFixed(2)}` : '-'
          }
        />
      </div>

      <Tabs defaultValue="output">
        <TabsList>
          <TabsTrigger value="output">Output</TabsTrigger>
          <TabsTrigger value="logs">Execution Logs</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
        </TabsList>

        <TabsContent value="output">
          <Card>
            <CardHeader>
              <CardTitle>Task Output</CardTitle>
            </CardHeader>
            <CardContent>
              <OutputSection output={task.output} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle>Execution Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <EventLog taskId={task.id} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="artifacts">
          <Card>
            <CardHeader>
              <CardTitle>Artifacts</CardTitle>
            </CardHeader>
            <CardContent>
              <ArtifactList taskId={task.id} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
