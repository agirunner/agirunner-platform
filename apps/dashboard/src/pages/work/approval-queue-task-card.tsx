import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CheckCircle,
  Clock3,
  Loader2,
  MessageSquare,
  XCircle,
} from 'lucide-react';

import {
  dashboardApi,
  type DashboardApprovalTaskRecord,
} from '../../lib/api.js';
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
import { Textarea } from '../../components/ui/textarea.js';
import {
  buildTaskApprovalBreadcrumbs,
  computeWaitingTime,
  readTaskOperatorFlowLabel,
} from './approval-queue-support.js';
import { QueueInfoTile } from './approval-queue-layout.js';
import { OperatorBreadcrumbTrail } from './operator-breadcrumb-trail.js';
import { invalidateWorkflowQueries } from '../workflow-detail/workflow-detail-query.js';
import {
  buildWorkflowOperatorPermalink,
  usesWorkItemOperatorFlow,
  usesWorkflowOperatorFlow,
} from './task-operator-flow.js';
import {
  buildApprovalDecisionPacket,
  buildApprovalOutputPacket,
  buildApprovalRecoveryPacket,
  sanitizeApprovalText,
  truncateOutput,
} from './approval-queue-task-card-support.js';

function invalidateApprovalWorkflowQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  workflowId?: string | null,
): Promise<void> {
  if (!workflowId) {
    return Promise.resolve();
  }
  return invalidateWorkflowQueries(queryClient, workflowId);
}

export function TaskApprovalCard(props: {
  task: DashboardApprovalTaskRecord;
}): JSX.Element {
  const { task } = props;
  const queryClient = useQueryClient();
  const [isChangesDialogOpen, setIsChangesDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const isOutputAssessment = task.state === 'output_pending_assessment';

  const approveMutation = useMutation({
    mutationFn: () =>
      isOutputAssessment ? dashboardApi.approveTaskOutput(task.id) : dashboardApi.approveTask(task.id),
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
  const decisionPacket = buildApprovalDecisionPacket(task);
  const recoveryPacket = buildApprovalRecoveryPacket(task);
  const outputPacket = buildApprovalOutputPacket(task);
  const taskLabel = task.title ?? task.id;
  const workItemFlow = usesWorkItemOperatorFlow(task);
  const workflowOperatorFlow = usesWorkflowOperatorFlow(task);
  const breadcrumbs = buildTaskApprovalBreadcrumbs(task).map((label) => ({ label }));
  const operatorFlowLabel = readTaskOperatorFlowLabel(task);
  const workflowContextLink =
    buildWorkflowOperatorPermalink(task) ??
    (task.workflow_id ? `/work/boards/${task.workflow_id}` : null);
  const primaryFlowLabel = workItemFlow ? 'Open Work Item Flow' : 'Open Workflow Operator Flow';
  const diagnosticsLabel = workflowOperatorFlow ? 'Open Step Diagnostics' : 'Open Step Record';
  const stepReferenceLabel = workflowOperatorFlow ? 'Step diagnostics' : 'Step record';
  const primaryTitleHref = workflowOperatorFlow && workflowContextLink
    ? workflowContextLink
    : `/work/tasks/${task.id}`;
  const handoffSummary = sanitizeApprovalText(task.latest_handoff?.summary);
  const successorContext = sanitizeApprovalText(task.latest_handoff?.successor_context);

  return (
    <>
      <Card className="border-border/80">
        <CardHeader className="gap-3 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={isOutputAssessment ? 'warning' : 'secondary'}>
                  {isOutputAssessment ? 'Output gate' : 'Step approval'}
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
                  <Link to={primaryTitleHref} className="text-accent hover:underline">
                    {taskLabel}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {workItemFlow
                    ? 'Review this specialist step from the grouped work-item flow so approval, rework, and retry context stays with the work item.'
                    : workflowOperatorFlow
                      ? 'Review this workflow-linked step from the workflow operator flow so approval, rework, and retry context stays attached to the board.'
                      : 'This specialist step is waiting on a direct operator decision.'}
                </CardDescription>
              </div>
              <div className="space-y-2">
                <OperatorBreadcrumbTrail items={breadcrumbs} emptyLabel="No board context yet" />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge variant="secondary">{operatorFlowLabel}</Badge>
                  {task.activation_id ? (
                    <Badge variant="outline">Activation: {task.activation_id}</Badge>
                  ) : null}
                </div>
                {task.workflow_name && task.workflow_id ? (
                  <Link
                    to={workflowContextLink ?? `/work/boards/${task.workflow_id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    Open board context
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
              {workflowOperatorFlow && workflowContextLink ? (
                <>
                  <Button size="sm" className="w-full sm:w-auto" asChild>
                    <Link to={workflowContextLink}>
                      {primaryFlowLabel}
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                    <Link to={`/work/tasks/${task.id}`}>{diagnosticsLabel}</Link>
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
                    {isOutputAssessment ? 'Approve Output' : 'Approve'}
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
                    <Link to={`/work/tasks/${task.id}`}>{diagnosticsLabel}</Link>
                  </Button>
                  {!workflowOperatorFlow && workflowContextLink ? (
                    <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                      <Link to={workflowContextLink}>Open Workflow Context</Link>
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {task.workflow_name ? <QueueInfoTile label="Board" value={task.workflow_name} /> : null}
            {task.work_item_title ? (
              <QueueInfoTile label="Work item" value={task.work_item_title} />
            ) : null}
            {task.stage_name ? <QueueInfoTile label="Stage" value={task.stage_name} /> : null}
            {task.role ? <QueueInfoTile label="Role" value={task.role} /> : null}
            <QueueInfoTile label="Operator flow" value={operatorFlowLabel} />
            <QueueInfoTile label={stepReferenceLabel} value={task.id} monospace />
          </div>

          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <ReviewPacketCard
              title={decisionPacket.title}
              summary={decisionPacket.summary}
            />
            <ReviewPacketCard
              title={recoveryPacket.title}
              summary={recoveryPacket.summary}
            />
            <ReviewPacketCard
              title="Current continuity"
              summary="Use the persisted platform continuity state to confirm who should act next before you approve, request changes, or reject."
            >
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">
                  Next expected actor: {task.next_expected_actor ?? 'Not set'}
                </Badge>
                <Badge variant="outline">
                  Next expected action: {task.next_expected_action ?? 'Not set'}
                </Badge>
                <Badge variant="outline">
                  Handoffs: {task.handoff_count ?? 0}
                </Badge>
              </div>
            </ReviewPacketCard>
            <ReviewPacketCard
              title="Latest handoff"
              summary={
                handoffSummary ||
                'No structured handoff is attached to this work item yet. Open the step record if you need direct execution evidence.'
              }
            >
              {task.latest_handoff ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {task.latest_handoff.role ? (
                      <Badge variant="outline">{task.latest_handoff.role}</Badge>
                    ) : null}
                    {task.latest_handoff.stage_name ? (
                      <Badge variant="outline">{task.latest_handoff.stage_name}</Badge>
                    ) : null}
                    {task.latest_handoff.completion ? (
                      <Badge variant="secondary">{task.latest_handoff.completion}</Badge>
                    ) : null}
                  </div>
                  {successorContext ? (
                    <div className="mt-3 rounded-xl border border-border/70 bg-surface p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted">
                        Successor context
                      </p>
                      <p className="mt-2 text-sm leading-6 text-muted">{successorContext}</p>
                    </div>
                  ) : null}
                </>
              ) : null}
            </ReviewPacketCard>
            <ReviewPacketCard
              title={outputPacket.title}
              summary={outputPacket.summary}
            >
              {outputPreview ? (
                <details className="mt-3 rounded-xl border border-border/70 bg-surface p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    View output preview
                  </summary>
                  <p className="mt-3 text-sm leading-6 text-muted">{outputPreview}</p>
                </details>
              ) : null}
            </ReviewPacketCard>
          </div>

          {(approveMutation.isError || rejectMutation.isError) && (
            <p className="text-xs text-red-600">Action failed. Please try again.</p>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!workflowOperatorFlow && isChangesDialogOpen}
        onOpenChange={setIsChangesDialogOpen}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
            <DialogDescription>
              {workflowOperatorFlow
                ? 'Use the workflow operator flow so board context stays aligned before mutating the step directly.'
                : `Provide feedback for "${taskLabel}".`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[75vh] gap-4 overflow-y-auto pr-1">
            <Textarea
              placeholder="Describe the changes needed..."
              rows={4}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              className="min-h-[140px]"
            />
            {requestChangesMutation.isError ? (
              <p className="text-sm text-red-600">Failed to submit feedback. Please try again.</p>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setIsChangesDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!feedback.trim() || requestChangesMutation.isPending}
                onClick={() => requestChangesMutation.mutate(feedback)}
              >
                {requestChangesMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Submit
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReviewPacketCard({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-border/10 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted">{summary}</p>
      {children}
    </div>
  );
}
