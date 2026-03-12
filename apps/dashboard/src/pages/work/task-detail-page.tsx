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
  FileText,
} from 'lucide-react';
import { dashboardApi, type DashboardTaskArtifactRecord } from '../../lib/api.js';
import { buildArtifactPermalink } from '../../components/artifact-preview-support.js';
import { LogViewer } from '../../components/log-viewer/log-viewer.js';
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
  stage_name?: string | null;
  work_item_id?: string | null;
  activation_id?: string | null;
  is_orchestrator_task?: boolean;
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
  return normalizeTaskStatus((task.status ?? task.state ?? 'unknown').toLowerCase());
}

function statusBadgeVariant(status: string) {
  const map: Record<string, 'success' | 'default' | 'destructive' | 'warning' | 'secondary'> = {
    completed: 'success',
    in_progress: 'default',
    failed: 'destructive',
    output_pending_review: 'warning',
    pending: 'secondary',
    awaiting_approval: 'warning',
    escalated: 'destructive',
    ready: 'secondary',
  };
  return map[status] ?? 'secondary';
}

function describeTaskKind(task: Task): string {
  const status = resolveStatus(task);
  if (task.is_orchestrator_task) {
    return 'Orchestrator activation';
  }
  if (status === 'output_pending_review') {
    return 'Output review';
  }
  if (status === 'awaiting_approval') {
    return 'Operator approval';
  }
  if (status === 'escalated') {
    return 'Escalated specialist task';
  }
  return 'Specialist task';
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
  const isOutputReview = status === 'output_pending_review';
  const isEscalated = status === 'escalated';
  const isFailed = status === 'failed';
  const isInProgress = status === 'in_progress';

  const approveMutation = useMutation({
    mutationFn: () =>
      isOutputReview ? dashboardApi.approveTaskOutput(task.id) : dashboardApi.approveTask(task.id),
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
      {isOutputReview && (
        <Button
          size="sm"
          disabled={isActionPending}
          onClick={() => approveMutation.mutate()}
        >
          <CheckCircle className="h-4 w-4" />
          Approve Output
        </Button>
      )}
      {isEscalated && (
        <Button variant="outline" size="sm" asChild>
          <a href="#escalation-response">
            <Workflow className="h-4 w-4" />
            Resolve Escalation
          </a>
        </Button>
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
      {isInProgress && (
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

function normalizeTaskStatus(status: string): string {
  if (status === 'running' || status === 'claimed') return 'in_progress';
  if (status === 'awaiting_escalation') return 'escalated';
  return status;
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
          <Button asChild variant="ghost" size="sm">
            <Link to={buildArtifactPermalink(artifact.task_id, artifact.id)}>
              <FileText className="h-4 w-4" />
              Preview
            </Link>
          </Button>
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
          <Badge variant="outline">{describeTaskKind(task)}</Badge>
        </div>
        <TaskActionButtons task={task} />
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-muted">
        {task.workflow_id ? (
          <Link to={`/work/workflows/${task.workflow_id}`} className="text-accent hover:underline">
            Workflow {task.workflow_name ?? task.workflow_id}
          </Link>
        ) : (
          <span>No workflow linked</span>
        )}
        {task.stage_name ? <span>Stage {task.stage_name}</span> : null}
        {task.work_item_id ? <span>Work item {task.work_item_id}</span> : null}
        {task.activation_id ? <span>Activation {task.activation_id}</span> : null}
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
        <InfoCard icon={Workflow} label="Stage" value={task.stage_name ?? '-'} />
        <InfoCard icon={Workflow} label="Work Item" value={task.work_item_id ?? '-'} />
        <InfoCard icon={Workflow} label="Activation" value={task.activation_id ?? '-'} />
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
          <TabsTrigger value="context">Execution Context</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
        </TabsList>

        <TabsContent value="output">
          <Card>
            <CardHeader>
              <CardTitle>Execution Output</CardTitle>
            </CardHeader>
            <CardContent>
              <OutputSection output={task.output} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="context">
          <Card>
            <CardHeader>
              <CardTitle>Execution Context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <InfoCard icon={Workflow} label="Task Kind" value={describeTaskKind(task)} />
                <InfoCard icon={Workflow} label="Status" value={status.replace(/_/g, ' ')} />
              </div>
              <div id="escalation-response" className="rounded-md border bg-border/10 p-4">
                <h3 className="text-sm font-medium">Escalation & Review Context</h3>
                <p className="mt-1 text-sm text-muted">
                  Use this task’s workflow, stage, work item, activation, and review state to decide the next operator action.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardContent className="pt-6">
              <LogViewer
                scope={{ taskId: task.id }}
                compact
              />
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
