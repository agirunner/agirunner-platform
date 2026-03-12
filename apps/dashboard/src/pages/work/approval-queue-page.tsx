import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Loader2,
  CheckCircle,
  XCircle,
  MessageSquare,
  Inbox,
  FileText,
  Workflow,
  Search,
} from 'lucide-react';
import {
  dashboardApi,
  type DashboardApprovalQueueResponse,
  type DashboardApprovalStageGateRecord,
  type DashboardApprovalTaskRecord,
} from '../../lib/api.js';
import { subscribeToEvents } from '../../lib/sse.js';
import { SavedViews, type SavedViewFilters } from '../../components/saved-views.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog.js';
import { GateDetailCard } from './gate-detail-card.js';
import { buildGateBreadcrumbs, readGatePacketSummary } from './gate-detail-support.js';
import { invalidateWorkflowQueries } from '../workflow-detail-query.js';
import { buildWorkflowDetailPermalink } from '../workflow-detail-permalinks.js';

function computeWaitingTime(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function truncateOutput(output: unknown): string {
  if (output === undefined || output === null) return '';
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  if (text.length <= 200) return text;
  return `${text.slice(0, 200)}...`;
}

function summarizeOldestWaiting(
  stageGates: DashboardApprovalStageGateRecord[],
  taskApprovals: DashboardApprovalTaskRecord[],
): string {
  const timestamps = [
    ...stageGates.map((gate) => gate.updated_at),
    ...taskApprovals.map((task) => task.created_at),
  ];
  if (timestamps.length === 0) {
    return 'No approvals pending';
  }
  const oldest = timestamps.reduce((currentOldest, timestamp) =>
    new Date(timestamp).getTime() < new Date(currentOldest).getTime() ? timestamp : currentOldest,
  );
  return `Oldest waiting ${computeWaitingTime(oldest)}`;
}

function sortStageGates(stageGates: DashboardApprovalStageGateRecord[]): DashboardApprovalStageGateRecord[] {
  return [...stageGates].sort(
    (left, right) => new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime(),
  );
}

function summarizeFirstGate(stageGates: DashboardApprovalStageGateRecord[]): string {
  if (stageGates.length === 0) {
    return 'No gates waiting';
  }
  return buildGateBreadcrumbs(stageGates[0]).join(' / ');
}

function matchesApprovalSearch(
  query: string,
  gate: DashboardApprovalStageGateRecord | DashboardApprovalTaskRecord,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  const searchCorpus = [
    'stage_name' in gate ? gate.stage_name : '',
    'stage_goal' in gate ? gate.stage_goal : '',
    'summary' in gate ? gate.summary : '',
    'recommendation' in gate ? gate.recommendation : '',
    'workflow_name' in gate ? gate.workflow_name : '',
    gate.workflow_id,
    'work_item_title' in gate ? gate.work_item_title : '',
    'work_item_id' in gate ? gate.work_item_id : '',
    'role' in gate ? gate.role : '',
    'activation_id' in gate ? gate.activation_id : '',
    'title' in gate ? gate.title : '',
    gate.id,
    'gate_id' in gate ? gate.gate_id : '',
    ...('concerns' in gate ? gate.concerns : []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();
  return searchCorpus.includes(normalizedQuery);
}

function invalidateApprovalWorkflowQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  workflowId?: string | null,
): Promise<void> {
  if (!workflowId) {
    return Promise.resolve();
  }
  return invalidateWorkflowQueries(queryClient, workflowId);
}

function TaskApprovalCard({ task }: { task: DashboardApprovalTaskRecord }): JSX.Element {
  const queryClient = useQueryClient();
  const [isChangesDialogOpen, setIsChangesDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const isOutputReview = task.state === 'output_pending_review';

  const approveMutation = useMutation({
    mutationFn: () =>
      isOutputReview ? dashboardApi.approveTaskOutput(task.id) : dashboardApi.approveTask(task.id),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['approval-queue'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['workflow'] });
      await invalidateApprovalWorkflowQueries(queryClient, task.workflow_id);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => dashboardApi.rejectTask(task.id, { feedback: 'Rejected from approval queue' }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['approval-queue'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['workflow'] });
      await invalidateApprovalWorkflowQueries(queryClient, task.workflow_id);
    },
  });

  const requestChangesMutation = useMutation({
    mutationFn: (changeFeedback: string) =>
      dashboardApi.requestTaskChanges(task.id, { feedback: changeFeedback }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['approval-queue'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['workflow'] });
      await invalidateApprovalWorkflowQueries(queryClient, task.workflow_id);
      setIsChangesDialogOpen(false);
      setFeedback('');
    },
  });

  const isActionPending =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    requestChangesMutation.isPending;

  const outputPreview = truncateOutput(task.output);
  const taskLabel = task.title ?? task.id;
  const workflowContextLink =
    task.workflow_id && task.work_item_id
      ? buildWorkflowDetailPermalink(task.workflow_id, {
          workItemId: task.work_item_id,
          activationId: task.activation_id ?? null,
        })
      : task.workflow_id
        ? `/work/workflows/${task.workflow_id}`
        : null;

  return (
    <>
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-1">
              <Link
                to={`/work/tasks/${task.id}`}
                className="text-sm font-semibold text-accent hover:underline"
              >
                {taskLabel}
              </Link>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge variant={isOutputReview ? 'warning' : 'secondary'}>
                  {isOutputReview ? 'Output review' : 'Manual approval'}
                </Badge>
                {task.workflow_name && (
                  <span>
                    Board:{' '}
                    <Link
                      to={workflowContextLink ?? `/work/workflows/${task.workflow_id}`}
                      className="text-accent hover:underline"
                    >
                      {task.workflow_name}
                    </Link>
                  </span>
                )}
                {task.work_item_title ? <span>Work item: {task.work_item_title}</span> : null}
                {task.stage_name ? <span>Stage: {task.stage_name}</span> : null}
                {task.role ? <span>Role: {task.role}</span> : null}
                {typeof task.rework_count === 'number' && task.rework_count > 0 ? (
                  <span>Rework round {task.rework_count + 1}</span>
                ) : null}
                <span>Waiting {computeWaitingTime(task.created_at)}</span>
              </div>

              {outputPreview && (
                <div className="mt-2 rounded-md border bg-border/10 p-3">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                    Output preview
                  </div>
                  <p className="text-xs text-muted">{outputPreview}</p>
                </div>
              )}
            </div>

            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                disabled={isActionPending}
                onClick={() => approveMutation.mutate()}
              >
                {approveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                {isOutputReview ? 'Approve Output' : 'Approve'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isActionPending}
                onClick={() => setIsChangesDialogOpen(true)}
              >
                <MessageSquare className="h-4 w-4" />
                Request Changes
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isActionPending}
                onClick={() => rejectMutation.mutate()}
              >
                {rejectMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                Reject
              </Button>
            </div>
          </div>

          {(approveMutation.isError || rejectMutation.isError) && (
            <p className="mt-2 text-xs text-red-600">Action failed. Please try again.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={isChangesDialogOpen} onOpenChange={setIsChangesDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
            <DialogDescription>
              Provide feedback for &ldquo;{taskLabel}&rdquo;.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Textarea
              placeholder="Describe the changes needed..."
              rows={4}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />

            {requestChangesMutation.isError && (
              <p className="text-sm text-red-600">Failed to submit feedback. Please try again.</p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsChangesDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!feedback.trim() || requestChangesMutation.isPending}
                onClick={() => requestChangesMutation.mutate(feedback)}
              >
                {requestChangesMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Submit
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ApprovalQueuePage(): JSX.Element {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, error } = useQuery<DashboardApprovalQueueResponse>({
    queryKey: ['approval-queue'],
    queryFn: () => dashboardApi.getApprovalQueue(),
  });
  const searchQuery = searchParams.get('q') ?? '';
  const queueFilter = searchParams.get('view') ?? 'all';

  useEffect(() => {
    return subscribeToEvents((eventType, payload) => {
      const workflowId =
        typeof payload.data?.workflow_id === 'string'
          ? payload.data.workflow_id
          : typeof payload.entity_type === 'string' && payload.entity_type === 'workflow'
            ? payload.entity_id
            : null;
      if (
        !eventType.startsWith('workflow.') &&
        !eventType.startsWith('task.') &&
        !eventType.startsWith('gate.') &&
        !eventType.startsWith('work_item.')
      ) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['approval-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow'] });
      if (workflowId) {
        void invalidateWorkflowQueries(queryClient, workflowId);
      }
    });
  }, [queryClient]);

  const taskApprovals = useMemo(() => {
    const items = data?.task_approvals ?? [];
    return items.filter((task) => {
      if (queueFilter === 'gates') {
        return false;
      }
      return matchesApprovalSearch(searchQuery, task);
    });
  }, [data?.task_approvals, queueFilter, searchQuery]);
  const stageGates = useMemo(() => {
    const items = sortStageGates(data?.stage_gates ?? []);
    return items.filter((gate) => {
      if (queueFilter === 'tasks') {
        return false;
      }
      return matchesApprovalSearch(searchQuery, gate);
    });
  }, [data?.stage_gates, queueFilter, searchQuery]);
  const totalApprovals = taskApprovals.length + stageGates.length;
  const oldestWaiting = summarizeOldestWaiting(stageGates, taskApprovals);
  const firstGateSummary = summarizeFirstGate(stageGates);
  const savedViewFilters = useMemo<SavedViewFilters>(
    () => ({
      ...(searchQuery ? { q: searchQuery } : {}),
      ...(queueFilter !== 'all' ? { view: queueFilter } : {}),
    }),
    [queueFilter, searchQuery],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-red-600">
        Failed to load approval queue. Please try again later.
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">Approval Queue</h1>
            <Badge variant="secondary">{totalApprovals}</Badge>
          </div>
          <p className="text-sm text-muted">
            Review stage gates first, then task-level approvals that remain after orchestration.
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 md:max-w-3xl">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <Input
                value={searchQuery}
                onChange={(event) =>
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current);
                    const value = event.target.value.trim();
                    if (value) {
                      next.set('q', value);
                    } else {
                      next.delete('q');
                    }
                    return next;
                  }, { replace: true })
                }
                placeholder="Search gates, work items, workflows, or IDs"
                className="pl-8"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={queueFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  next.delete('view');
                  return next;
                }, { replace: true })}
              >
                All
              </Button>
              <Button
                variant={queueFilter === 'gates' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set('view', 'gates');
                  return next;
                }, { replace: true })}
              >
                Gates
              </Button>
              <Button
                variant={queueFilter === 'tasks' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set('view', 'tasks');
                  return next;
                }, { replace: true })}
              >
                Tasks
              </Button>
              <SavedViews
                storageKey="approval-queue"
                currentFilters={savedViewFilters}
                onApply={(filters) =>
                  setSearchParams(
                    {
                      ...(filters.q ? { q: filters.q } : {}),
                      ...(filters.view ? { view: filters.view } : {}),
                    },
                    { replace: true },
                  )
                }
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
                <Workflow className="h-3.5 w-3.5" />
                Stage gates
              </div>
              <div className="mt-2 text-2xl font-semibold">{stageGates.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
                <FileText className="h-3.5 w-3.5" />
                Task reviews
              </div>
              <div className="mt-2 text-2xl font-semibold">{taskApprovals.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted">Oldest wait</div>
              <div className="mt-2 text-sm font-semibold">{oldestWaiting}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted">First up</div>
              <div className="mt-2 text-sm font-semibold">{firstGateSummary}</div>
            </CardContent>
          </Card>
        </div>
        </div>
      </div>

      {totalApprovals === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Inbox className="h-12 w-12 text-muted" />
            <p className="mt-4 text-lg font-medium">No tasks awaiting approval</p>
            <p className="mt-1 text-sm text-muted">
              Task approvals and stage gates will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {stageGates.length > 0 ? (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-medium">Stage Gates</h2>
                <Badge variant="secondary">{stageGates.length}</Badge>
              </div>
              <p className="text-sm text-muted">
                Gates are ordered by oldest wait first so operators can clear the stalest review packets before newer requests.
              </p>
              {stageGates.map((gate) => (
                <div
                  key={`${gate.workflow_id}:${gate.stage_name}:${(gate as unknown as { gate_id?: string; id?: string }).gate_id ?? (gate as unknown as { gate_id?: string; id?: string }).id ?? 'pending'}`}
                  className="space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge variant="outline">Queue priority</Badge>
                    <span>{buildGateBreadcrumbs(gate).join(' / ')}</span>
                    {readGatePacketSummary(gate).map((item) => (
                    <Badge key={`${gate.workflow_id}:${gate.stage_name}:${item}`} variant="secondary">
                        {item}
                      </Badge>
                    ))}
                    <Link
                      to={buildWorkflowDetailPermalink(gate.workflow_id, {
                        gateStageName: gate.stage_name,
                      })}
                      className="text-accent hover:underline"
                    >
                      Open workflow gate
                    </Link>
                  </div>
                  <GateDetailCard gate={gate} source="approval-queue" />
                </div>
              ))}
            </section>
          ) : null}

          {taskApprovals.length > 0 ? (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-medium">Task Reviews</h2>
                <Badge variant="secondary">{taskApprovals.length}</Badge>
              </div>
              {taskApprovals.map((task) => (
                <TaskApprovalCard key={task.id} task={task} />
              ))}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
