import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle, RotateCcw, Workflow, XCircle } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { dashboardApi } from '../../lib/api.js';
import {
  buildWorkflowOperatorPermalink,
  usesWorkItemOperatorFlow,
  usesWorkflowOperatorFlow,
} from '../work-shared/task-operator-flow.js';
import {
  StepManualEscalationDialog,
  StepOutputOverrideDialog,
  WorkItemReassignDialog,
  formatOutputOverrideDraft,
  parseOutputOverrideDraft,
} from '../workflow-detail/workflow-work-item-task-review-dialogs.js';
import { resolveStatus, type Task } from './task-detail-page.model.js';

export function TaskActionButtons({ task }: { task: Task }): JSX.Element {
  const queryClient = useQueryClient();
  const agentsQuery = useQuery({
    queryKey: ['task-detail-agents'],
    queryFn: () => dashboardApi.listAgents(),
    staleTime: 60_000,
  });
  const status = resolveStatus(task);
  const isAwaitingApproval = status === 'awaiting_approval';
  const isOutputAssessment = status === 'output_pending_assessment';
  const isEscalated = status === 'escalated';
  const isFailed = status === 'failed';
  const isInProgress = status === 'in_progress';
  const isClaimed = status === 'claimed';
  const workItemFlow = usesWorkItemOperatorFlow(task);
  const workflowOperatorFlow = usesWorkflowOperatorFlow(task);
  const workflowOperatorPermalink = buildWorkflowOperatorPermalink(task);
  const [isManualEscalationDialogOpen, setIsManualEscalationDialogOpen] = useState(false);
  const [isOutputOverrideDialogOpen, setIsOutputOverrideDialogOpen] = useState(false);
  const [isReassignDialogOpen, setIsReassignDialogOpen] = useState(false);
  const [escalationReason, setEscalationReason] = useState('');
  const [escalationTarget, setEscalationTarget] = useState('human');
  const [outputOverrideDraft, setOutputOverrideDraft] = useState(formatOutputOverrideDraft(task.output));
  const [outputOverrideReason, setOutputOverrideReason] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [reassignAgentId, setReassignAgentId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const approveMutation = useMutation({
    mutationFn: () =>
      isOutputAssessment ? dashboardApi.approveTaskOutput(task.id) : dashboardApi.approveTask(task.id),
    onSuccess: () => invalidateTaskQueries(queryClient, task.id, setActionError),
  });
  const rejectMutation = useMutation({
    mutationFn: () => dashboardApi.rejectTask(task.id, { feedback: 'Rejected from dashboard' }),
    onSuccess: () => invalidateTaskQueries(queryClient, task.id, setActionError),
  });
  const retryMutation = useMutation({
    mutationFn: () => dashboardApi.retryTask(task.id),
    onSuccess: () => invalidateTaskQueries(queryClient, task.id, setActionError),
  });
  const cancelMutation = useMutation({
    mutationFn: () => dashboardApi.cancelTask(task.id),
    onSuccess: () => invalidateTaskQueries(queryClient, task.id, setActionError),
  });
  const reassignMutation = useMutation({
    mutationFn: () => {
      const selectedAgentId = reassignAgentId?.trim();
      if (!selectedAgentId) {
        throw new Error('Select an agent before reassigning this step.');
      }
      const reason = reassignReason.trim();
      if (!reason) {
        throw new Error('Add a reason before reassigning this step.');
      }
      return dashboardApi.reassignTask(task.id, {
        preferred_agent_id: selectedAgentId,
        reason,
      });
    },
    onSuccess: () => {
      setReassignReason('');
      setReassignAgentId(null);
      setIsReassignDialogOpen(false);
      invalidateTaskQueries(queryClient, task.id, setActionError);
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Failed to reassign step.');
    },
  });
  const escalateMutation = useMutation({
    mutationFn: () => {
      const reason = escalationReason.trim();
      if (!reason) {
        throw new Error('Add a reason before escalating this step.');
      }
      return dashboardApi.escalateTask(task.id, {
        reason,
        escalation_target: escalationTarget.trim() || 'human',
      });
    },
    onSuccess: () => {
      setEscalationReason('');
      setEscalationTarget('human');
      setIsManualEscalationDialogOpen(false);
      invalidateTaskQueries(queryClient, task.id, setActionError);
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Failed to escalate step.');
    },
  });
  const overrideOutputMutation = useMutation({
    mutationFn: () =>
      dashboardApi.overrideTaskOutput(task.id, {
        output: parseOutputOverrideDraft(outputOverrideDraft),
        reason: outputOverrideReason.trim(),
      }),
    onSuccess: () => {
      setIsOutputOverrideDialogOpen(false);
      setOutputOverrideDraft(formatOutputOverrideDraft(task.output));
      setOutputOverrideReason('');
      invalidateTaskQueries(queryClient, task.id, setActionError);
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Failed to override output.');
    },
  });

  const isActionPending =
    approveMutation.isPending ||
    reassignMutation.isPending ||
    escalateMutation.isPending ||
    overrideOutputMutation.isPending ||
    rejectMutation.isPending ||
    retryMutation.isPending ||
    cancelMutation.isPending;
  const canReassign = status !== 'completed' && status !== 'escalated';
  const canEscalate = isClaimed || isInProgress;

  if (workflowOperatorPermalink && workflowOperatorFlow) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <Button size="sm" asChild>
            <Link to={workflowOperatorPermalink}>
              {workItemFlow ? 'Open Work Item Flow' : 'Open Workflow Operator Flow'}
            </Link>
          </Button>
        </div>
        <p className="text-xs text-muted">
          {workItemFlow
            ? 'This step belongs to a workflow work item. Operator review, rework, and retry decisions should run through the work-item panel so gate state, linked steps, and board context stay aligned.'
            : 'Use the workflow operator flow so board context stays aligned before mutating the step directly. Override the stored output packet there when review requires a corrected payload.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {isAwaitingApproval ? (
          <>
            <Button size="sm" disabled={isActionPending} onClick={() => approveMutation.mutate()}>
              <CheckCircle className="h-4 w-4" />
              Approve Step
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isActionPending}
              onClick={() => rejectMutation.mutate()}
            >
              <XCircle className="h-4 w-4" />
              Reject Step
            </Button>
          </>
        ) : null}
        {isOutputAssessment ? (
          <>
            <Button size="sm" disabled={isActionPending} onClick={() => approveMutation.mutate()}>
              <CheckCircle className="h-4 w-4" />
              Approve Output
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isActionPending}
              onClick={() => {
                setActionError(null);
                setOutputOverrideDraft(formatOutputOverrideDraft(task.output));
                setOutputOverrideReason('');
                setIsOutputOverrideDialogOpen(true);
              }}
            >
              Override Output
            </Button>
          </>
        ) : null}
        {isEscalated ? (
          <Button variant="outline" size="sm" asChild>
            <a href="#escalation-response">
              <Workflow className="h-4 w-4" />
              Open Escalation Context
            </a>
          </Button>
        ) : null}
        {canEscalate ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isActionPending}
            onClick={() => {
              setActionError(null);
              setEscalationReason('');
              setEscalationTarget('human');
              setIsManualEscalationDialogOpen(true);
            }}
          >
            <Workflow className="h-4 w-4" />
            Escalate Step
          </Button>
        ) : null}
        {canReassign ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isActionPending}
            onClick={() => {
              setActionError(null);
              setReassignReason('');
              setReassignAgentId(null);
              setIsReassignDialogOpen(true);
            }}
          >
            <RotateCcw className="h-4 w-4" />
            Reassign Step
          </Button>
        ) : null}
        {isFailed ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isActionPending}
            onClick={() => retryMutation.mutate()}
          >
            <RotateCcw className="h-4 w-4" />
            Retry Step
          </Button>
        ) : null}
        {isInProgress ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={isActionPending}
            onClick={() => cancelMutation.mutate()}
          >
            <XCircle className="h-4 w-4" />
            Cancel
          </Button>
        ) : null}
      </div>
      {actionError ? <p className="text-xs text-destructive">{actionError}</p> : null}
      <StepManualEscalationDialog
        isOpen={isManualEscalationDialogOpen}
        taskTitle={task.title ?? task.name ?? task.id}
        escalationTarget={escalationTarget}
        reason={escalationReason}
        error={isManualEscalationDialogOpen ? actionError : null}
        isPending={isActionPending}
        onOpenChange={(open) => {
          setIsManualEscalationDialogOpen(open);
          if (!open) {
            setEscalationReason('');
            setEscalationTarget('human');
          }
        }}
        onEscalationTargetChange={setEscalationTarget}
        onReasonChange={setEscalationReason}
        onSubmit={() => escalateMutation.mutate()}
      />
      <StepOutputOverrideDialog
        isOpen={isOutputOverrideDialogOpen}
        taskTitle={task.title ?? task.name ?? task.id}
        description="Override the stored output packet before approving the step."
        outputDraft={outputOverrideDraft}
        reason={outputOverrideReason}
        error={isOutputOverrideDialogOpen ? actionError : null}
        isPending={isActionPending}
        onOpenChange={(open) => {
          setIsOutputOverrideDialogOpen(open);
          if (!open) {
            setOutputOverrideDraft(formatOutputOverrideDraft(task.output));
            setOutputOverrideReason('');
          }
        }}
        onOutputDraftChange={setOutputOverrideDraft}
        onReasonChange={setOutputOverrideReason}
        onSubmit={() => overrideOutputMutation.mutate()}
      />
      <WorkItemReassignDialog
        isOpen={isReassignDialogOpen}
        taskTitle={task.title ?? task.name ?? task.id}
        agents={agentsQuery.data ?? []}
        selectedAgentId={reassignAgentId}
        reason={reassignReason}
        isLoadingAgents={agentsQuery.isLoading}
        isPending={isActionPending}
        onOpenChange={(open) => {
          setIsReassignDialogOpen(open);
          if (!open) {
            setReassignReason('');
            setReassignAgentId(null);
          }
        }}
        onAgentChange={setReassignAgentId}
        onReasonChange={setReassignReason}
        onSubmit={() => reassignMutation.mutate()}
      />
    </div>
  );
}

function invalidateTaskQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  taskId: string,
  setActionError: (next: string | null) => void,
) {
  setActionError(null);
  queryClient.invalidateQueries({ queryKey: ['task', taskId] });
  queryClient.invalidateQueries({ queryKey: ['tasks'] });
}
