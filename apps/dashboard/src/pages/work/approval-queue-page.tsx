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
  Clock3,
  GitBranch,
  ShieldAlert,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
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
import {
  buildGateBreadcrumbs,
  readGateDecisionSummary,
  readGatePacketSummary,
  readGateRequestSourceSummary,
  readGateResumptionSummary,
} from './gate-detail-support.js';
import { readGateResumeTaskSummary } from './gate-handoff-support.js';
import {
  buildTaskApprovalBreadcrumbs,
  computeWaitingTime,
  countPendingOrchestratorFollowUp,
  matchesApprovalSearch,
  readTaskOperatorFlowLabel,
  sortStageGates,
  summarizeFirstGate,
  summarizeOldestWaiting,
  truncateOutput,
  usesWorkItemOperatorFlow,
} from './approval-queue-support.js';
import { OperatorBreadcrumbTrail } from './operator-breadcrumb-trail.js';
import { invalidateWorkflowQueries } from '../workflow-detail-query.js';
import { buildWorkflowDetailPermalink } from '../workflow-detail-permalinks.js';

function invalidateApprovalWorkflowQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  workflowId?: string | null,
): Promise<void> {
  if (!workflowId) {
    return Promise.resolve();
  }
  return invalidateWorkflowQueries(queryClient, workflowId);
}

function updateApprovalQueueSearchParams(
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  updater: (params: URLSearchParams) => void,
): void {
  setSearchParams((current) => {
    const next = new URLSearchParams(current);
    updater(next);
    return next;
  }, { replace: true });
}

function gateQueuePriorityVariant(index: number): 'destructive' | 'warning' | 'outline' {
  if (index === 0) {
    return 'destructive';
  }
  if (index < 3) {
    return 'warning';
  }
  return 'outline';
}

function renderQueuePriorityLabel(index: number): string {
  if (index === 0) {
    return 'Queue priority 1';
  }
  return `Queue priority ${index + 1}`;
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
  const workItemFlow = usesWorkItemOperatorFlow(task);
  const breadcrumbs = buildTaskApprovalBreadcrumbs(task);
  const operatorFlowLabel = readTaskOperatorFlowLabel(task);
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
      <Card className="border-border/80">
        <CardHeader className="gap-3 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={isOutputReview ? 'warning' : 'secondary'}>
                  {isOutputReview ? 'Output gate' : 'Step approval'}
                </Badge>
                <Badge variant="outline">
                  <Clock3 className="mr-1 h-3 w-3" />
                  Waiting {computeWaitingTime(task.created_at)}
                </Badge>
                {typeof task.rework_count === 'number' && task.rework_count > 0 ? (
                  <Badge variant="outline">Rework round {task.rework_count + 1}</Badge>
                ) : null}
                {task.activation_id ? (
                  <Badge variant="outline">Activation {task.activation_id}</Badge>
                ) : null}
              </div>
              <div className="space-y-1">
                <CardTitle className="text-base">
                  <Link
                    to={`/work/tasks/${task.id}`}
                    className="text-accent hover:underline"
                  >
                    {taskLabel}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {workItemFlow
                    ? 'Review this step from the grouped work-item operator flow so approval, rework, and retry context stays attached to the work item.'
                    : 'This step is waiting on a direct operator decision.'}
                </CardDescription>
              </div>
              <div className="space-y-2">
                <OperatorBreadcrumbTrail items={breadcrumbs} emptyLabel="No board context yet" />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge variant="secondary">{operatorFlowLabel}</Badge>
                  {task.activation_id ? <Badge variant="outline">Activation: {task.activation_id}</Badge> : null}
                </div>
                {task.workflow_name && task.workflow_id ? (
                  <Link
                    to={workflowContextLink ?? `/work/workflows/${task.workflow_id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    Open board context
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
              {workItemFlow && workflowContextLink ? (
                <>
                  <Button size="sm" className="w-full sm:w-auto" asChild>
                    <Link to={workflowContextLink}>Open Work Item Flow</Link>
                  </Button>
                  <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                    <Link to={`/work/tasks/${task.id}`}>Open Step Record</Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    className="w-full sm:w-auto"
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
                    className="w-full sm:w-auto"
                    disabled={isActionPending}
                    onClick={() => setIsChangesDialogOpen(true)}
                  >
                    <MessageSquare className="h-4 w-4" />
                    Request Changes
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full sm:w-auto"
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
                  <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                    <Link to={`/work/tasks/${task.id}`}>Open Step Record</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            {task.workflow_name ? (
              <QueueInfoTile label="Board" value={task.workflow_name} />
            ) : null}
            {task.work_item_title ? (
              <QueueInfoTile label="Work item" value={task.work_item_title} />
            ) : null}
            {task.stage_name ? <QueueInfoTile label="Stage" value={task.stage_name} /> : null}
            {task.role ? <QueueInfoTile label="Role" value={task.role} /> : null}
            <QueueInfoTile label="Operator flow" value={operatorFlowLabel} />
            <QueueInfoTile
              label="Step record"
              value={task.id}
              monospace
            />
          </div>

          {outputPreview ? (
            <div className="rounded-md border border-border/70 bg-border/10 p-3">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                Output preview
              </div>
              <p className="text-xs text-muted">{outputPreview}</p>
            </div>
          ) : null}

          {(approveMutation.isError || rejectMutation.isError) && (
            <p className="text-xs text-red-600">Action failed. Please try again.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={!workItemFlow && isChangesDialogOpen} onOpenChange={setIsChangesDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
            <DialogDescription>
              Provide feedback for &ldquo;{taskLabel}&rdquo;.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[75vh] gap-4 overflow-y-auto pr-1">
            <Textarea
              placeholder="Describe the changes needed..."
              rows={4}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="min-h-[140px]"
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

function QueueInfoTile(props: {
  label: string;
  value: string;
  monospace?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-md border border-border/70 bg-border/10 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {props.label}
      </div>
      <div className={props.monospace ? 'mt-1 font-mono text-sm' : 'mt-1 text-sm font-medium'}>
        {props.value}
      </div>
    </div>
  );
}

function QueueMetricCard(props: {
  icon: JSX.Element;
  label: string;
  value: string | number;
  detail?: string;
}): JSX.Element {
  return (
    <article className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
        {props.icon}
        {props.label}
      </div>
      <div className="mt-2 break-words text-2xl font-semibold">{props.value}</div>
      {props.detail ? <p className="mt-2 text-xs leading-5 text-muted">{props.detail}</p> : null}
    </article>
  );
}

function QueueSectionHeader(props: {
  icon: JSX.Element;
  title: string;
  count: number;
  description: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {props.icon}
          <h2 className="text-lg font-medium">{props.title}</h2>
          <Badge variant="secondary">{props.count}</Badge>
        </div>
        <p className="text-sm text-muted">{props.description}</p>
      </div>
    </div>
  );
}

function StageGateQueueCard(props: {
  gate: DashboardApprovalStageGateRecord;
  index: number;
}): JSX.Element {
  const { gate, index } = props;
  const breadcrumbs = buildGateBreadcrumbs(gate);
  const packetSummary = readGatePacketSummary(gate);
  const requestSource = readGateRequestSourceSummary(gate);
  const decisionSummary = readGateDecisionSummary(gate);
  const resumptionSummary = readGateResumptionSummary(gate);
  const resumeTaskSummary = readGateResumeTaskSummary(gate);

  return (
    <Card className="border-border/80">
      <CardHeader className="gap-3 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={gateQueuePriorityVariant(index)}>
                {renderQueuePriorityLabel(index)}
              </Badge>
              <Badge variant="outline">
                <Clock3 className="mr-1 h-3 w-3" />
                Oldest wait first
              </Badge>
              <Badge variant="outline">{decisionSummary}</Badge>
              <Badge variant="outline">{resumptionSummary}</Badge>
            </div>
              <div className="space-y-1">
                <CardTitle className="text-base">{gate.stage_name}</CardTitle>
                <CardDescription>
                  {gate.stage_goal || 'Human review packet for this stage gate.'}
                </CardDescription>
              </div>
            <OperatorBreadcrumbTrail items={breadcrumbs} />
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
              <Link
                to={buildWorkflowDetailPermalink(gate.workflow_id, {
                  gateStageName: gate.stage_name,
                })}
              >
                Open board gate
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <QueueInfoTile label="Board" value={gate.workflow_name || gate.workflow_id} />
          <QueueInfoTile label="Stage" value={gate.stage_name} />
          <QueueInfoTile label="Updated" value={computeWaitingTime(gate.updated_at)} />
          <QueueInfoTile
            label="Gate record"
            value={gate.gate_id || gate.id}
            monospace
          />
        </div>
        {packetSummary.length > 0 || requestSource.length > 0 || resumptionSummary ? (
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-md border border-border/70 bg-border/10 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                <GitBranch className="h-3.5 w-3.5" />
                Gate packet
              </div>
              <div className="flex flex-wrap gap-2">
                {packetSummary.map((item) => (
                  <Badge
                    key={`${gate.workflow_id}:${gate.stage_name}:packet:${item}`}
                    variant="secondary"
                  >
                    {item}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-border/70 bg-border/10 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                <ShieldAlert className="h-3.5 w-3.5" />
                Request source
              </div>
              <div className="flex flex-wrap gap-2">
                {requestSource.map((item) => (
                  <Badge
                    key={`${gate.workflow_id}:${gate.stage_name}:source:${item}`}
                    variant="outline"
                  >
                    {item}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-border/70 bg-border/10 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                <Workflow className="h-3.5 w-3.5" />
                Orchestrator follow-up
              </div>
              <p className="text-xs text-muted">{resumptionSummary}</p>
              {gate.orchestrator_resume?.reason ? (
                <p className="mt-2 text-xs text-muted">{gate.orchestrator_resume.reason}</p>
              ) : null}
              {resumeTaskSummary ? (
                <p className="mt-2 text-xs text-muted">Follow-up step: {resumeTaskSummary}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="rounded-md border border-border/70 bg-border/10 p-3 text-sm text-muted">
          Open the full gate packet for the decision trail, key artifacts, and orchestrator follow-up
          context before acting.
        </div>
        <details className="rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Open full review packet
          </summary>
          <div className="mt-4">
            <GateDetailCard gate={gate} source="approval-queue" />
          </div>
        </details>
      </CardContent>
    </Card>
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
  const pendingFollowUpCount = countPendingOrchestratorFollowUp(stageGates);
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
      <section className="space-y-5 rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold">Approval Queue</h1>
              <Badge variant="secondary">{totalApprovals}</Badge>
            </div>
            <p className="text-sm text-muted">
              Review stage gates first, then specialist step approvals and output gates that remain after orchestration.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 md:max-w-3xl">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-end">
              <div className="relative w-full lg:max-w-xs">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <Input
                  value={searchQuery}
                onChange={(event) =>
                  updateApprovalQueueSearchParams(setSearchParams, (next) => {
                    const value = event.target.value.trim();
                    if (value) {
                      next.set('q', value);
                    } else {
                      next.delete('q');
                    }
                  })
                }
                placeholder="Search gates, boards, work items, stages, steps, or IDs"
                className="pl-8"
              />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={queueFilter === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() =>
                    updateApprovalQueueSearchParams(setSearchParams, (next) => {
                      next.delete('view');
                    })
                  }
                >
                  All
                </Button>
                <Button
                  variant={queueFilter === 'gates' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() =>
                    updateApprovalQueueSearchParams(setSearchParams, (next) => {
                      next.set('view', 'gates');
                    })
                  }
                >
                  Gates
                </Button>
                <Button
                  variant={queueFilter === 'tasks' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() =>
                    updateApprovalQueueSearchParams(setSearchParams, (next) => {
                      next.set('view', 'tasks');
                    })
                  }
                >
                  Steps
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
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <QueueMetricCard
                icon={<Workflow className="h-3.5 w-3.5" />}
                label="Stage gates"
                value={stageGates.length}
                detail="Human review packets waiting by stage."
              />
              <QueueMetricCard
                icon={<FileText className="h-3.5 w-3.5" />}
                label="Specialist step reviews"
                value={taskApprovals.length}
                detail="Direct approvals or output reviews still owned by operators."
              />
              <QueueMetricCard
                icon={<GitBranch className="h-3.5 w-3.5" />}
                label="Awaiting follow-up"
                value={`${pendingFollowUpCount} gates`}
                detail="Human decisions recorded without a visible orchestrator follow-up yet."
              />
              <QueueMetricCard
                icon={<Clock3 className="h-3.5 w-3.5" />}
                label="Oldest wait"
                value={oldestWaiting}
                detail="Use this to clear stale queue items first."
              />
              <QueueMetricCard
                icon={<ShieldAlert className="h-3.5 w-3.5" />}
                label="First up"
                value={firstGateSummary}
                detail="The oldest stage gate currently waiting."
              />
            </div>
          </div>
        </div>
      </section>

      {totalApprovals === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Inbox className="h-12 w-12 text-muted" />
            <p className="mt-4 text-lg font-medium">No operator queue items waiting</p>
            <p className="mt-1 text-sm text-muted">
              Stage gates, specialist step approvals, and output gates will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {stageGates.length > 0 ? (
            <section className="space-y-4 rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
              <QueueSectionHeader
                icon={<Workflow className="h-4 w-4 text-muted" />}
                title="Stage Gates"
                count={stageGates.length}
                description="Review packets are ordered by oldest wait first so operators can clear stale gates before newer requests."
              />
              {stageGates.map((gate, index) => (
                <StageGateQueueCard
                  key={`${gate.workflow_id}:${gate.stage_name}:${(gate as { gate_id?: string; id?: string }).gate_id ?? (gate as { gate_id?: string; id?: string }).id ?? 'pending'}`}
                  gate={gate}
                  index={index}
                />
              ))}
            </section>
          ) : null}

          {taskApprovals.length > 0 ? (
            <section className="space-y-4 rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
              <QueueSectionHeader
                icon={<FileText className="h-4 w-4 text-muted" />}
                title="Step Approvals"
                count={taskApprovals.length}
                description="These operator decisions apply to specialist steps blocked on approval, output review, or rework guidance."
              />
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
