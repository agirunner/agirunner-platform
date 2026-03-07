import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Loader2,
  Pause,
  Play,
  XCircle,
  Clock,
  DollarSign,
  FolderOpen,
  FileText,
} from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../../components/ui/tabs.js';

interface WorkflowTask {
  id: string;
  name?: string;
  title?: string;
  status: string;
  state?: string;
  role?: string;
  agent_id?: string;
  agent_name?: string;
  duration_seconds?: number;
  started_at?: string;
  completed_at?: string;
  output?: unknown;
}

interface WorkflowPhase {
  name: string;
  status: string;
  state?: string;
}

interface Workflow {
  id: string;
  name: string;
  status: string;
  state?: string;
  project_id?: string;
  project_name?: string;
  template_id?: string;
  template_name?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  cost?: number;
  current_phase?: string;
  phases?: WorkflowPhase[];
  tasks?: WorkflowTask[];
}

function normalizeWorkflow(response: unknown): Workflow {
  const wrapped = response as { data?: unknown };
  if (wrapped?.data && typeof wrapped.data === 'object' && 'id' in (wrapped.data as object)) {
    return wrapped.data as Workflow;
  }
  return response as Workflow;
}

function resolveStatus(entity: { status?: string; state?: string }): string {
  return (entity.status ?? entity.state ?? 'unknown').toLowerCase();
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

function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null) {
    return '-';
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

function computeDuration(workflow: Workflow): string {
  if (workflow.duration_seconds !== undefined && workflow.duration_seconds !== null) {
    return formatDuration(workflow.duration_seconds);
  }
  if (!workflow.started_at) {
    return '-';
  }
  const start = new Date(workflow.started_at).getTime();
  const end = workflow.completed_at ? new Date(workflow.completed_at).getTime() : Date.now();
  return formatDuration((end - start) / 1000);
}

function PhaseProgress({
  phases,
  currentPhase,
}: {
  phases: WorkflowPhase[];
  currentPhase?: string;
}): JSX.Element {
  if (phases.length === 0) {
    return <p className="text-sm text-muted">No phase data available.</p>;
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-2">
      {phases.map((phase, idx) => {
        const status = resolveStatus(phase);
        const isCurrent = phase.name === currentPhase;
        const isCompleted = status === 'completed';
        const isFailed = status === 'failed';

        return (
          <div key={phase.name} className="flex items-center">
            {idx > 0 && (
              <div
                className={cn(
                  'mx-1 h-0.5 w-6',
                  isCompleted ? 'bg-green-500' : 'bg-border',
                )}
              />
            )}
            <div
              className={cn(
                'flex items-center rounded-md border px-3 py-1.5 text-xs font-medium capitalize',
                isCurrent && 'border-accent bg-accent/10 text-accent',
                isCompleted && !isCurrent && 'border-green-300 bg-green-50 text-green-700',
                isFailed && 'border-red-300 bg-red-50 text-red-700',
                !isCurrent && !isCompleted && !isFailed && 'border-border text-muted',
              )}
            >
              {phase.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActionButtons({
  workflow,
}: {
  workflow: Workflow;
}): JSX.Element {
  const queryClient = useQueryClient();
  const status = resolveStatus(workflow);

  const pauseMutation = useMutation({
    mutationFn: () => dashboardApi.pauseWorkflow(workflow.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow', workflow.id] }),
  });

  const resumeMutation = useMutation({
    mutationFn: () => dashboardApi.resumeWorkflow(workflow.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow', workflow.id] }),
  });

  const cancelMutation = useMutation({
    mutationFn: () => dashboardApi.cancelWorkflow(workflow.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow', workflow.id] }),
  });

  const isActionPending = pauseMutation.isPending || resumeMutation.isPending || cancelMutation.isPending;

  return (
    <div className="flex gap-2">
      {status === 'running' && (
        <Button
          variant="outline"
          size="sm"
          disabled={isActionPending}
          onClick={() => pauseMutation.mutate()}
        >
          <Pause className="h-4 w-4" />
          Pause
        </Button>
      )}
      {status === 'paused' && (
        <Button
          variant="outline"
          size="sm"
          disabled={isActionPending}
          onClick={() => resumeMutation.mutate()}
        >
          <Play className="h-4 w-4" />
          Resume
        </Button>
      )}
      {(status === 'running' || status === 'paused') && (
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

function TasksTable({ tasks }: { tasks: WorkflowTask[] }): JSX.Element {
  const navigate = useNavigate();

  if (tasks.length === 0) {
    return <p className="py-4 text-center text-sm text-muted">No tasks for this workflow.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => {
          const status = resolveStatus(task);
          return (
            <TableRow
              key={task.id}
              className="cursor-pointer"
              onClick={() => navigate(`/work/tasks/${task.id}`)}
            >
              <TableCell className="font-medium">{task.title ?? task.name ?? task.id}</TableCell>
              <TableCell className="capitalize">{task.role ?? '-'}</TableCell>
              <TableCell>
                <Badge variant={statusBadgeVariant(status)} className="capitalize">
                  {status.replace(/_/g, ' ')}
                </Badge>
              </TableCell>
              <TableCell>{task.agent_name ?? task.agent_id ?? '-'}</TableCell>
              <TableCell>{formatDuration(task.duration_seconds)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function WorkflowDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => dashboardApi.getWorkflow(id!),
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
      <div className="p-6 text-red-600">Failed to load workflow. Please try again later.</div>
    );
  }

  const workflow = normalizeWorkflow(data);
  const status = resolveStatus(workflow);
  const tasks = workflow.tasks ?? [];
  const phases = workflow.phases ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{workflow.name}</h1>
          <Badge variant={statusBadgeVariant(status)} className="capitalize">
            {status}
          </Badge>
        </div>
        <ActionButtons workflow={workflow} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <FolderOpen className="h-4 w-4" />
              Project
            </div>
            <p className="mt-1 text-sm font-medium">{workflow.project_name ?? '-'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <FileText className="h-4 w-4" />
              Template
            </div>
            <p className="mt-1 text-sm font-medium">{workflow.template_name ?? '-'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Clock className="h-4 w-4" />
              Created
            </div>
            <p className="mt-1 text-sm font-medium">
              {new Date(workflow.created_at).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Clock className="h-4 w-4" />
              Duration
            </div>
            <p className="mt-1 text-sm font-medium">{computeDuration(workflow)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <DollarSign className="h-4 w-4" />
              Cost
            </div>
            <p className="mt-1 text-sm font-medium">
              {workflow.cost !== undefined && workflow.cost !== null
                ? `$${workflow.cost.toFixed(2)}`
                : '-'}
            </p>
          </CardContent>
        </Card>
      </div>

      {phases.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Phase Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <PhaseProgress phases={phases} currentPhase={workflow.current_phase} />
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="output">Output / Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks">
          <Card>
            <CardContent className="p-0">
              <TasksTable tasks={tasks} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="output">
          <Card>
            <CardContent>
              {tasks.length === 0 ? (
                <p className="text-sm text-muted">No task output available.</p>
              ) : (
                <div className="space-y-4">
                  {tasks
                    .filter((t) => t.output !== undefined && t.output !== null)
                    .map((t) => (
                      <div key={t.id} className="space-y-1">
                        <p className="text-sm font-medium">{t.title ?? t.name ?? t.id}</p>
                        <pre className="overflow-x-auto rounded-md border bg-border/10 p-3 text-xs">
                          {typeof t.output === 'string'
                            ? t.output
                            : JSON.stringify(t.output, null, 2)}
                        </pre>
                      </div>
                    ))}
                  {tasks.every((t) => t.output === undefined || t.output === null) && (
                    <p className="text-sm text-muted">No task output available yet.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
