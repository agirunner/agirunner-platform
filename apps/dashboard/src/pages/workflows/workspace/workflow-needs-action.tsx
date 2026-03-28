import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog.js';
import { Textarea } from '../../../components/ui/textarea.js';
import type {
  DashboardWorkflowNeedsActionItem,
  DashboardWorkflowNeedsActionPacket,
  DashboardWorkflowNeedsActionResponseAction,
} from '../../../lib/api.js';
import { dashboardApi } from '../../../lib/api.js';
import { toast } from '../../../lib/toast.js';
import { invalidateWorkflowsQueries } from '../workflows-query.js';

export function WorkflowNeedsAction(props: {
  workflowId: string;
  workspaceId?: string | null;
  packet: DashboardWorkflowNeedsActionPacket;
  onOpenAddWork(): void;
  onOpenRedrive(): void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [promptAction, setPromptAction] = useState<DashboardWorkflowNeedsActionResponseAction | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [promptError, setPromptError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (action: DashboardWorkflowNeedsActionResponseAction) =>
      runNeedsAction(action, promptValue),
    onSuccess: async (_result, action) => {
      await invalidateWorkflowsQueries(queryClient, props.workflowId, props.workspaceId);
      setPromptAction(null);
      setPromptValue('');
      setPromptError(null);
      toast.success(readSuccessMessage(action.kind));
    },
    onError: (error) => {
      setPromptError(error instanceof Error ? error.message : 'Failed to apply operator action.');
    },
  });

  const promptMeta = useMemo(() => buildPromptMeta(promptAction), [promptAction]);

  function handleAction(action: DashboardWorkflowNeedsActionResponseAction): void {
    if (action.kind === 'add_work_item') {
      props.onOpenAddWork();
      return;
    }
    if (action.kind === 'redrive_workflow') {
      props.onOpenRedrive();
      return;
    }
    if (action.prompt_kind !== 'none') {
      setPromptAction(action);
      setPromptValue('');
      setPromptError(null);
      return;
    }
    mutation.mutate(action);
  }

  function handlePromptSubmit(): void {
    if (!promptAction) {
      return;
    }
    if (!promptValue.trim()) {
      setPromptError(promptMeta.requiredMessage);
      return;
    }
    mutation.mutate(promptAction);
  }

  return (
    <>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Needs Action</p>
            <p className="text-sm text-muted-foreground">
              Prioritized workflow actions that currently require an operator response.
            </p>
          </div>
        </div>

        {props.packet.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
            Nothing in this workflow requires operator action right now.
          </div>
        ) : (
          <div className="grid gap-3">
            {props.packet.items.map((item) => (
              <NeedsActionCard
                key={item.action_id}
                item={item}
                isPending={mutation.isPending}
                onAction={handleAction}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={promptAction !== null}
        onOpenChange={(nextOpen) => {
          if (mutation.isPending) {
            return;
          }
          if (!nextOpen) {
            setPromptAction(null);
            setPromptValue('');
            setPromptError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{promptMeta.title}</DialogTitle>
            <DialogDescription>{promptMeta.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Textarea
              value={promptValue}
              onChange={(event) => setPromptValue(event.target.value)}
              rows={5}
              placeholder={promptMeta.placeholder}
              aria-invalid={Boolean(promptError)}
            />
            {promptError ? <p className="text-sm text-destructive">{promptError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPromptAction(null);
                  setPromptValue('');
                  setPromptError(null);
                }}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="button" onClick={handlePromptSubmit} disabled={mutation.isPending}>
                {promptMeta.confirmLabel}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NeedsActionCard(props: {
  item: DashboardWorkflowNeedsActionItem;
  isPending: boolean;
  onAction(action: DashboardWorkflowNeedsActionResponseAction): void;
}): JSX.Element {
  return (
    <article className="grid gap-3 rounded-2xl border border-border/70 bg-background/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-foreground">{props.item.label}</strong>
        <Badge variant="warning">{humanizeToken(props.item.target.target_kind)}</Badge>
        <Badge variant="secondary">{humanizePriority(props.item.priority)} priority</Badge>
        {props.item.requires_confirmation ? <Badge variant="outline">Confirm</Badge> : null}
      </div>
      <div className="grid gap-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Why it needs action
        </p>
        <p className="text-sm text-muted-foreground">{props.item.summary}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {props.item.responses.map((action) => (
          <Button
            key={action.action_id}
            type="button"
            size="sm"
            variant={action.kind === 'reject_task' ? 'destructive' : action.kind === 'request_changes_task' ? 'outline' : 'default'}
            disabled={props.isPending}
            onClick={() => props.onAction(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </article>
  );
}

async function runNeedsAction(
  action: DashboardWorkflowNeedsActionResponseAction,
  promptValue: string,
): Promise<void> {
  switch (action.kind) {
    case 'approve_task':
      await dashboardApi.approveTask(action.target.target_id);
      return;
    case 'approve_task_output':
      await dashboardApi.approveTaskOutput(action.target.target_id);
      return;
    case 'reject_task':
      await dashboardApi.rejectTask(action.target.target_id, { feedback: promptValue.trim() });
      return;
    case 'request_changes_task':
      await dashboardApi.requestTaskChanges(action.target.target_id, { feedback: promptValue.trim() });
      return;
    case 'resolve_escalation':
      await dashboardApi.resolveEscalation(action.target.target_id, { instructions: promptValue.trim() });
      return;
    case 'retry_task':
      await dashboardApi.retryTask(action.target.target_id);
      return;
    default:
      throw new Error(`Unsupported needs-action response '${action.kind}'.`);
  }
}

function readSuccessMessage(actionKind: string): string {
  switch (actionKind) {
    case 'approve_task':
      return 'Approval recorded';
    case 'approve_task_output':
      return 'Output approval recorded';
    case 'reject_task':
      return 'Rejection recorded';
    case 'request_changes_task':
      return 'Change request recorded';
    case 'resolve_escalation':
      return 'Escalation resolved';
    case 'retry_task':
      return 'Retry requested';
    default:
      return 'Operator action applied';
  }
}

function buildPromptMeta(
  action: DashboardWorkflowNeedsActionResponseAction | null,
): {
  title: string;
  description: string;
  placeholder: string;
  confirmLabel: string;
  requiredMessage: string;
} {
  if (!action) {
    return {
      title: 'Operator response',
      description: '',
      placeholder: '',
      confirmLabel: 'Apply',
      requiredMessage: 'Enter a response before continuing.',
    };
  }
  if (action.prompt_kind === 'instructions') {
    return {
      title: 'Resume with guidance',
      description: 'Provide the concrete operator guidance that should unblock this escalated task.',
      placeholder: 'Describe the guidance the specialist or orchestrator should follow next...',
      confirmLabel: 'Resume task',
      requiredMessage: 'Enter operator guidance before continuing.',
    };
  }
  return {
    title: action.kind === 'reject_task' ? 'Reject task' : 'Request task changes',
    description: 'Attach explicit operator feedback to this task so the next workflow step is clear.',
    placeholder: 'Describe the changes or rejection reason...',
    confirmLabel: action.kind === 'reject_task' ? 'Reject' : 'Request changes',
    requiredMessage: 'Enter review feedback before continuing.',
  };
}

function humanizeToken(value: string | null | undefined): string {
  if (!value) {
    return 'Workflow';
  }
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function humanizePriority(value: string): string {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'high':
      return 'High';
    case 'low':
      return 'Low';
    default:
      return 'Medium';
  }
}
