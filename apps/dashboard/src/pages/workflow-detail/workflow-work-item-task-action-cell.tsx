import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { dashboardApi, type DashboardAgentRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { buildWorkItemTaskLinkActions } from './workflow-work-item-task-actions.js';
import {
  StepChangesDialog,
  StepEscalationDialog,
  StepOutputOverrideDialog,
  WorkItemReassignDialog,
} from './workflow-work-item-task-review-dialogs.js';
import {
  formatOutputOverrideDraft,
  parseOutputOverrideDraft,
} from './workflow-work-item-task-review-dialogs.support.js';
import {
  describeTaskOperatorPosture,
  type DashboardWorkItemTaskRecord,
} from './workflow-work-item-detail-support.js';

const errorTextClass =
  'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700';

export function WorkItemTaskActionCell(props: {
  workflowId: string;
  workItemId: string;
  task: DashboardWorkItemTaskRecord;
  agents: DashboardAgentRecord[];
  isLoadingAgents: boolean;
  onWorkItemChanged(): Promise<unknown> | unknown;
}): JSX.Element {
  const [isChangesDialogOpen, setIsChangesDialogOpen] = useState(false);
  const [isEscalationDialogOpen, setIsEscalationDialogOpen] = useState(false);
  const [isOutputOverrideDialogOpen, setIsOutputOverrideDialogOpen] = useState(false);
  const [isReassignDialogOpen, setIsReassignDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [instructions, setInstructions] = useState('');
  const [outputOverrideDraft, setOutputOverrideDraft] = useState(
    formatOutputOverrideDraft(undefined),
  );
  const [outputOverrideReason, setOutputOverrideReason] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [reassignAgentId, setReassignAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = props.task.state;
  const scopedWorkItemId = props.task.work_item_id ?? props.workItemId;
  const taskLinks = buildWorkItemTaskLinkActions({
    workflowId: props.workflowId,
    taskId: props.task.id,
    workItemId: props.task.work_item_id,
    state,
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      state === 'output_pending_assessment'
        ? dashboardApi.approveWorkflowWorkItemTaskOutput(
            props.workflowId,
            scopedWorkItemId,
            props.task.id,
          )
        : dashboardApi.approveWorkflowWorkItemTask(
            props.workflowId,
            scopedWorkItemId,
            props.task.id,
          ),
    onSuccess: async () => {
      setError(null);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to approve step.');
    },
  });
  const rejectMutation = useMutation({
    mutationFn: () =>
      dashboardApi.rejectWorkflowWorkItemTask(props.workflowId, scopedWorkItemId, props.task.id, {
        feedback,
      }),
    onSuccess: async () => {
      setError(null);
      setFeedback('');
      setIsChangesDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to reject step.');
    },
  });
  const requestChangesMutation = useMutation({
    mutationFn: () =>
      dashboardApi.requestWorkflowWorkItemTaskChanges(
        props.workflowId,
        scopedWorkItemId,
        props.task.id,
        { feedback },
      ),
    onSuccess: async () => {
      setError(null);
      setFeedback('');
      setIsChangesDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error ? mutationError.message : 'Failed to request changes.',
      );
    },
  });
  const overrideOutputMutation = useMutation({
    mutationFn: () =>
      dashboardApi.overrideWorkflowWorkItemTaskOutput(
        props.workflowId,
        scopedWorkItemId,
        props.task.id,
        {
          output: parseOutputOverrideDraft(outputOverrideDraft),
          reason: outputOverrideReason.trim(),
        },
      ),
    onSuccess: async () => {
      setError(null);
      setOutputOverrideDraft(formatOutputOverrideDraft(undefined));
      setOutputOverrideReason('');
      setIsOutputOverrideDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error ? mutationError.message : 'Failed to override output.',
      );
    },
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
      return dashboardApi.reassignWorkflowWorkItemTask(
        props.workflowId,
        scopedWorkItemId,
        props.task.id,
        {
          preferred_agent_id: selectedAgentId,
          reason,
        },
      );
    },
    onSuccess: async () => {
      setError(null);
      setReassignReason('');
      setReassignAgentId(null);
      setIsReassignDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to reassign step.');
    },
  });
  const resolveEscalationMutation = useMutation({
    mutationFn: () =>
      dashboardApi.resolveWorkflowWorkItemTaskEscalation(
        props.workflowId,
        scopedWorkItemId,
        props.task.id,
        { instructions: instructions.trim() },
      ),
    onSuccess: async () => {
      setError(null);
      setInstructions('');
      setIsEscalationDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error ? mutationError.message : 'Failed to resume escalated step.',
      );
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () =>
      dashboardApi.cancelWorkflowWorkItemTask(props.workflowId, scopedWorkItemId, props.task.id),
    onSuccess: async () => {
      setError(null);
      setFeedback('');
      setInstructions('');
      setOutputOverrideDraft(formatOutputOverrideDraft(undefined));
      setOutputOverrideReason('');
      setReassignReason('');
      setReassignAgentId(null);
      setIsChangesDialogOpen(false);
      setIsEscalationDialogOpen(false);
      setIsOutputOverrideDialogOpen(false);
      setIsReassignDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to cancel step.');
    },
  });

  const canApprove = state === 'awaiting_approval' || state === 'output_pending_assessment';
  const canOverrideOutput = state === 'output_pending_assessment';
  const canRequestChanges =
    state === 'awaiting_approval' || state === 'output_pending_assessment' || state === 'failed';
  const canResolveEscalation = state === 'escalated';
  const canCancel = state === 'failed' || state === 'escalated' || state === 'in_progress';
  const canReassign = state !== 'completed' && state !== 'cancelled';
  const isAnyMutationPending =
    approveMutation.isPending ||
    overrideOutputMutation.isPending ||
    rejectMutation.isPending ||
    requestChangesMutation.isPending ||
    reassignMutation.isPending ||
    resolveEscalationMutation.isPending ||
    cancelMutation.isPending;

  return (
    <div className="grid gap-3">
      <TaskOperatorPosturePanel task={props.task} />
      <div className="flex flex-wrap items-center gap-2">
        {taskLinks.map((action) => (
          <Link key={`${props.task.id}:${action.label}`} to={action.href}>
            {action.label}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canApprove ? (
          <Button
            size="sm"
            onClick={() => approveMutation.mutate()}
            disabled={isAnyMutationPending}
          >
            {state === 'output_pending_assessment' ? 'Approve Output' : 'Approve Step'}
          </Button>
        ) : null}
        {canOverrideOutput ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setError(null);
              setOutputOverrideDraft(formatOutputOverrideDraft(undefined));
              setOutputOverrideReason('');
              setIsOutputOverrideDialogOpen(true);
            }}
            disabled={isAnyMutationPending}
          >
            Override Output
          </Button>
        ) : null}
        {canRequestChanges ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsChangesDialogOpen(true)}
            disabled={isAnyMutationPending}
          >
            Request Changes
          </Button>
        ) : null}
        {canResolveEscalation ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsEscalationDialogOpen(true)}
            disabled={isAnyMutationPending}
          >
            Resume with Guidance
          </Button>
        ) : null}
        {canReassign ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsReassignDialogOpen(true)}
            disabled={isAnyMutationPending}
          >
            Reassign Step
          </Button>
        ) : null}
        {canCancel ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => cancelMutation.mutate()}
            disabled={isAnyMutationPending}
          >
            Cancel Step
          </Button>
        ) : null}
      </div>
      {error ? <p className={errorTextClass}>{error}</p> : null}
      <StepChangesDialog
        isOpen={isChangesDialogOpen}
        state={state}
        taskTitle={props.task.title}
        feedback={feedback}
        isPending={isAnyMutationPending}
        onOpenChange={setIsChangesDialogOpen}
        onFeedbackChange={setFeedback}
        onReject={() => rejectMutation.mutate()}
        onRequestChanges={() => requestChangesMutation.mutate()}
      />
      <StepEscalationDialog
        isOpen={isEscalationDialogOpen}
        taskTitle={props.task.title}
        instructions={instructions}
        isPending={isAnyMutationPending}
        onOpenChange={setIsEscalationDialogOpen}
        onInstructionsChange={setInstructions}
        onSubmit={() => resolveEscalationMutation.mutate()}
      />
      <StepOutputOverrideDialog
        isOpen={isOutputOverrideDialogOpen}
        taskTitle={props.task.title}
        description={`Override the stored output packet for “${props.task.title}” without leaving the selected work-item flow.`}
        outputDraft={outputOverrideDraft}
        reason={outputOverrideReason}
        error={isOutputOverrideDialogOpen ? error : null}
        isPending={isAnyMutationPending}
        onOpenChange={(open) => {
          setIsOutputOverrideDialogOpen(open);
          if (!open) {
            setOutputOverrideDraft(formatOutputOverrideDraft(undefined));
            setOutputOverrideReason('');
          }
        }}
        onOutputDraftChange={setOutputOverrideDraft}
        onReasonChange={setOutputOverrideReason}
        onSubmit={() => overrideOutputMutation.mutate()}
      />
      <WorkItemReassignDialog
        isOpen={isReassignDialogOpen}
        taskTitle={props.task.title}
        agents={props.agents}
        selectedAgentId={reassignAgentId}
        reason={reassignReason}
        isLoadingAgents={props.isLoadingAgents}
        isPending={isAnyMutationPending}
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

function TaskOperatorPosturePanel(props: { task: DashboardWorkItemTaskRecord }): JSX.Element {
  const posture = describeTaskOperatorPosture(props.task);
  return (
    <div className="grid gap-1 rounded-lg border border-border/70 bg-background/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          Operator next step
        </div>
        <Badge variant={posture.tone}>{posture.title}</Badge>
      </div>
      <p className="text-xs leading-5 text-muted">{posture.detail}</p>
    </div>
  );
}
