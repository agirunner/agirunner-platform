import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import { Textarea } from '../../../components/ui/textarea.js';
import type {
  DashboardWorkflowNeedsActionDetail,
  DashboardWorkflowNeedsActionItem,
  DashboardWorkflowNeedsActionPacket,
  DashboardWorkflowNeedsActionResponseAction,
} from '../../../lib/api.js';
import { dashboardApi } from '../../../lib/api.js';
import { toast } from '../../../lib/toast.js';
import { invalidateWorkflowsQueries } from '../workflows-query.js';
import { resolveNeedsActionWorkflowTaskContext } from './workflow-needs-action.support.js';

export function WorkflowNeedsAction(props: {
  workflowId: string;
  workspaceId?: string | null;
  scopeSubject?: 'workflow' | 'work item' | 'task';
  scopeLabel?: string;
  packet: DashboardWorkflowNeedsActionPacket;
  onOpenAddWork?(workItemId: string | null): void;
}): JSX.Element {
  const normalizedScope = normalizeNeedsActionScope(props.scopeSubject, props.scopeLabel);
  const scopeSubject = normalizedScope.subject;
  const visibleItems = props.packet.items.filter(shouldDisplayNeedsActionItem);
  const scopeSummary = props.packet.scope_summary ?? {
    workflow_total_count: props.packet.total_count,
    selected_scope_total_count: visibleItems.length,
    scoped_away_workflow_count: 0,
  };
  const queryClient = useQueryClient();
  const [promptAction, setPromptAction] = useState<DashboardWorkflowNeedsActionResponseAction | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [promptError, setPromptError] = useState<string | null>(null);
  const [hasAttemptedPromptSubmit, setHasAttemptedPromptSubmit] = useState(false);

  const mutation = useMutation({
    mutationFn: async (input: {
      item: DashboardWorkflowNeedsActionItem;
      action: DashboardWorkflowNeedsActionResponseAction;
    }) => runNeedsAction(props.workflowId, input.item, input.action, promptValue),
    onSuccess: async (_result, input) => {
      await invalidateWorkflowsQueries(queryClient, props.workflowId, props.workspaceId);
      setPromptAction(null);
      setPromptValue('');
      setPromptError(null);
      setHasAttemptedPromptSubmit(false);
      toast.success(readSuccessMessage(input.action.kind));
    },
    onError: (error) => {
      setPromptError(error instanceof Error ? error.message : 'Failed to apply operator action.');
    },
  });

  function handleAction(item: DashboardWorkflowNeedsActionItem, action: DashboardWorkflowNeedsActionResponseAction): void {
    if (action.prompt_kind !== 'none') {
      setPromptAction(action);
      setPromptValue('');
      setPromptError(null);
      setHasAttemptedPromptSubmit(false);
      return;
    }
    mutation.mutate({ item, action });
  }

  function handlePromptSubmit(): void {
    if (!promptAction) {
      return;
    }
    setHasAttemptedPromptSubmit(true);
    if (!promptValue.trim()) {
      return;
    }
    const promptItem = visibleItems.find((item) =>
      item.responses.some((action) => action.action_id === promptAction.action_id),
    );
    if (!promptItem) {
      setPromptError('The selected operator action is no longer available.');
      return;
    }
    mutation.mutate({ item: promptItem, action: promptAction });
  }

  function handlePromptChange(value: string): void {
    setPromptValue(value);
    setPromptError(null);
  }

  return (
    <div className="grid gap-4">
      {visibleItems.length === 0 ? (
        <div className="grid gap-1 px-1 text-sm text-muted-foreground">
          <p>Nothing in this {scopeSubject} requires operator action right now.</p>
          {scopeSummary.scoped_away_workflow_count > 0 && scopeSubject !== 'workflow' ? (
            <p>
              {readScopedAwayWorkflowMessage(scopeSummary.scoped_away_workflow_count)}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid max-h-[28rem] gap-3 overflow-y-auto pr-1">
          {visibleItems.map((item) => (
            <NeedsActionPacketCard
              key={item.action_id}
              item={item}
              visibleScopeSubject={scopeSubject}
              activePromptActionId={promptAction?.action_id ?? null}
              promptValue={promptValue}
              promptError={promptError}
              hasAttemptedPromptSubmit={hasAttemptedPromptSubmit}
              isPending={mutation.isPending}
              onAction={(action) => handleAction(item, action)}
              onPromptChange={handlePromptChange}
              onPromptCancel={() => {
                if (mutation.isPending) {
                  return;
                }
                setPromptAction(null);
                setPromptValue('');
                setPromptError(null);
                setHasAttemptedPromptSubmit(false);
              }}
              onPromptSubmit={handlePromptSubmit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NeedsActionPacketCard(props: {
  item: DashboardWorkflowNeedsActionItem;
  visibleScopeSubject: 'workflow' | 'work item';
  activePromptActionId: string | null;
  promptValue: string;
  promptError: string | null;
  hasAttemptedPromptSubmit: boolean;
  isPending: boolean;
  onAction(action: DashboardWorkflowNeedsActionResponseAction): void;
  onPromptChange(value: string): void;
  onPromptCancel(): void;
  onPromptSubmit(): void;
}): JSX.Element {
  const responses = props.item.responses.filter(isVisibleNeedsActionResponse);
  const activePromptAction = responses.find((action) => action.action_id === props.activePromptActionId) ?? null;
  const promptMeta = buildPromptMeta(activePromptAction);
  const validationError =
    activePromptAction && props.hasAttemptedPromptSubmit && !props.promptValue.trim()
      ? promptMeta.requiredMessage
      : null;
  const promptMessage = props.promptError ?? validationError;
  const visibleTargetKind = describeNeedsActionVisibleTargetKind(
    props.visibleScopeSubject,
    props.item.target.target_kind,
  );
  const dossier = buildNeedsActionDossier(props.item, visibleTargetKind);

  return (
    <article className="grid gap-3 rounded-xl border border-border/60 bg-background/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-foreground">{props.item.label}</strong>
        <Badge variant="warning">{humanizeToken(visibleTargetKind)}</Badge>
        <Badge variant="secondary">{humanizePriority(props.item.priority)} priority</Badge>
        {props.item.requires_confirmation ? <Badge variant="outline">Confirm</Badge> : null}
      </div>

      <DossierSection title="Needs decision" value={dossier.needsDecision} />
      <DossierSection title="Why it needs action" value={dossier.whyItNeedsAction} />
      <DossierSection title="Blocking now" value={dossier.blockingNow} />
      <DossierSection title="Work so far" value={dossier.workSoFar} />
      {dossier.evidence ? <DossierSection title="Evidence" value={dossier.evidence} /> : null}

      <div className="flex flex-wrap gap-2">
        {responses.map((action) => (
          <Button
            key={action.action_id}
            type="button"
            size="sm"
            variant={
              action.kind === 'reject_task' || action.kind === 'reject_gate'
                ? 'destructive'
                : action.kind === 'request_changes_task' || action.kind === 'request_changes_gate'
                  ? 'outline'
                  : 'default'
            }
            disabled={props.isPending}
            onClick={() => props.onAction(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>

      {activePromptAction ? (
        <div className="grid gap-3 rounded-lg border border-amber-300/80 bg-amber-50/60 p-3 dark:border-amber-500/60 dark:bg-amber-950/20">
          <div className="grid gap-1">
            <p className="text-sm font-semibold text-foreground">{promptMeta.title}</p>
            {promptMeta.description ? (
              <p className="text-sm text-muted-foreground">{promptMeta.description}</p>
            ) : null}
          </div>
          <Textarea
            value={props.promptValue}
            onChange={(event) => props.onPromptChange(event.target.value)}
            onInput={(event) => props.onPromptChange((event.target as HTMLTextAreaElement).value)}
            rows={4}
            placeholder={promptMeta.placeholder}
            aria-invalid={Boolean(promptMessage)}
          />
          {promptMessage ? <p className="text-sm text-destructive">{promptMessage}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={props.onPromptCancel} disabled={props.isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={props.onPromptSubmit} disabled={props.isPending}>
              {promptMeta.confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function DossierSection(props: {
  title: string;
  value: string;
}): JSX.Element {
  return (
    <div className="grid gap-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {props.title}
      </p>
      <p className="text-sm leading-6 text-foreground">{props.value}</p>
    </div>
  );
}

function buildNeedsActionDossier(
  item: DashboardWorkflowNeedsActionItem,
  visibleTargetKind: DashboardWorkflowNeedsActionItem['target']['target_kind'],
): {
  needsDecision: string;
  whyItNeedsAction: string;
  blockingNow: string;
  workSoFar: string;
  evidence: string | null;
} {
  return {
    needsDecision:
      readDetailValue(item.details, ['approval_target', 'requested_decision', 'decision', 'escalation'])
      ?? `${item.label} for this ${humanizeToken(visibleTargetKind).toLowerCase()}.`,
    whyItNeedsAction: readSentence(item.summary) ?? 'This packet is waiting on an operator decision.',
    blockingNow:
      readDetailValue(item.details, ['blocking_state', 'blocked_state', 'blocking_reason', 'context'])
      ?? `Progress is paused until an operator responds to this ${humanizeToken(visibleTargetKind).toLowerCase()} packet.`,
    workSoFar:
      readDetailValue(item.details, ['work_so_far', 'progress', 'status', 'context'])
      ?? 'No additional work summary was attached to this packet yet.',
    evidence: readCombinedDetailValues(item.details, ['verification', 'evidence', 'output', 'deliverable', 'artifacts']),
  };
}

function normalizeNeedsActionScope(
  scopeSubject: 'workflow' | 'work item' | 'task' | undefined,
  scopeLabel: string | undefined,
): { subject: 'workflow' | 'work item'; label: string } {
  if (scopeSubject === 'task') {
    return {
      subject: 'work item',
      label: scopeLabel?.startsWith('Work item:') ? scopeLabel : 'This work item',
    };
  }
  const subject = scopeSubject ?? 'workflow';
  return {
    subject,
    label: scopeLabel ?? `This ${subject}`,
  };
}

function describeNeedsActionVisibleTargetKind(
  visibleScopeSubject: 'workflow' | 'work item',
  actionTargetKind: DashboardWorkflowNeedsActionItem['target']['target_kind'],
): DashboardWorkflowNeedsActionItem['target']['target_kind'] {
  if (visibleScopeSubject === 'work item' && actionTargetKind === 'task') {
    return 'work_item';
  }
  return actionTargetKind;
}

async function runNeedsAction(
  workflowId: string,
  item: DashboardWorkflowNeedsActionItem,
  action: DashboardWorkflowNeedsActionResponseAction,
  promptValue: string,
): Promise<void> {
  switch (action.kind) {
    case 'approve_task': {
      const workflowTaskContext = resolveNeedsActionWorkflowTaskContext({ item, action });
      await dashboardApi.approveWorkflowWorkItemTask(
        workflowId,
        workflowTaskContext.workItemId,
        workflowTaskContext.taskId,
      );
      return;
    }
    case 'approve_task_output': {
      const workflowTaskContext = resolveNeedsActionWorkflowTaskContext({ item, action });
      await dashboardApi.approveWorkflowWorkItemTaskOutput(
        workflowId,
        workflowTaskContext.workItemId,
        workflowTaskContext.taskId,
      );
      return;
    }
    case 'reject_task': {
      const workflowTaskContext = resolveNeedsActionWorkflowTaskContext({ item, action });
      await dashboardApi.rejectWorkflowWorkItemTask(
        workflowId,
        workflowTaskContext.workItemId,
        workflowTaskContext.taskId,
        { feedback: promptValue.trim() },
      );
      return;
    }
    case 'request_changes_task': {
      const workflowTaskContext = resolveNeedsActionWorkflowTaskContext({ item, action });
      await dashboardApi.requestWorkflowWorkItemTaskChanges(
        workflowId,
        workflowTaskContext.workItemId,
        workflowTaskContext.taskId,
        { feedback: promptValue.trim() },
      );
      return;
    }
    case 'resolve_escalation': {
      const workflowTaskContext = resolveNeedsActionWorkflowTaskContext({ item, action });
      await dashboardApi.resolveWorkflowWorkItemTaskEscalation(
        workflowId,
        workflowTaskContext.workItemId,
        workflowTaskContext.taskId,
        { instructions: promptValue.trim() },
      );
      return;
    }
    case 'approve_gate':
      await dashboardApi.actOnWorkflowGate(workflowId, action.target.target_id, { action: 'approve' });
      return;
    case 'reject_gate':
      await dashboardApi.actOnWorkflowGate(workflowId, action.target.target_id, {
        action: 'reject',
        feedback: promptValue.trim(),
      });
      return;
    case 'request_changes_gate':
      await dashboardApi.actOnWorkflowGate(workflowId, action.target.target_id, {
        action: 'request_changes',
        feedback: promptValue.trim(),
      });
      return;
    case 'retry_task': {
      const workflowTaskContext = resolveNeedsActionWorkflowTaskContext({ item, action });
      await dashboardApi.retryWorkflowWorkItemTask(
        workflowId,
        workflowTaskContext.workItemId,
        workflowTaskContext.taskId,
      );
      return;
    }
    case 'redrive_workflow':
      await dashboardApi.redriveWorkflow(workflowId, { request_id: crypto.randomUUID() });
      return;
    default:
      throw new Error(`Unsupported needs-action response '${action.kind}'.`);
  }
}

function isVisibleNeedsActionResponse(
  action: DashboardWorkflowNeedsActionResponseAction,
): boolean {
  return action.kind === 'approve_task'
    || action.kind === 'approve_task_output'
    || action.kind === 'approve_gate'
    || action.kind === 'reject_task'
    || action.kind === 'reject_gate'
    || action.kind === 'request_changes_task'
    || action.kind === 'request_changes_gate'
    || action.kind === 'resolve_escalation';
}

function shouldDisplayNeedsActionItem(item: DashboardWorkflowNeedsActionItem): boolean {
  return item.responses.some(isVisibleNeedsActionResponse);
}

function readSuccessMessage(actionKind: string): string {
  switch (actionKind) {
    case 'approve_task':
      return 'Approval recorded';
    case 'approve_task_output':
      return 'Output approval recorded';
    case 'reject_task':
      return 'Rejection recorded';
    case 'approve_gate':
      return 'Approval recorded';
    case 'reject_gate':
      return 'Rejection recorded';
    case 'request_changes_task':
      return 'Change request recorded';
    case 'request_changes_gate':
      return 'Change request recorded';
    case 'resolve_escalation':
      return 'Escalation resolved';
    default:
      return 'Operator action applied';
  }
}

function readScopedAwayWorkflowMessage(scopedAwayWorkflowCount: number): string {
  if (scopedAwayWorkflowCount === 1) {
    return '1 workflow-level action remains available in workflow scope.';
  }
  return `${scopedAwayWorkflowCount} workflow-level actions remain available in workflow scope.`;
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
    title:
      action.kind === 'reject_task' || action.kind === 'reject_gate'
        ? 'Reject approval'
        : 'Request changes',
    description:
      action.kind === 'reject_gate' || action.kind === 'request_changes_gate'
        ? 'Attach explicit operator feedback to this approval gate so the next workflow step is clear.'
        : 'Attach explicit operator feedback to this task so the next workflow step is clear.',
    placeholder: 'Describe the changes or rejection reason...',
    confirmLabel:
      action.kind === 'reject_task' || action.kind === 'reject_gate'
        ? 'Reject'
        : 'Request changes',
    requiredMessage: 'Enter review feedback before continuing.',
  };
}

function readDetailValue(
  details: DashboardWorkflowNeedsActionDetail[] | undefined,
  labels: string[],
): string | null {
  if (!details) {
    return null;
  }

  for (const detail of details) {
    if (labels.includes(normalizeDetailLabel(detail.label))) {
      return readSentence(detail.value) ?? null;
    }
  }

  return null;
}

function readCombinedDetailValues(
  details: DashboardWorkflowNeedsActionDetail[] | undefined,
  labels: string[],
): string | null {
  if (!details) {
    return null;
  }

  const values = details
    .filter((detail) => labels.includes(normalizeDetailLabel(detail.label)))
    .map((detail) => readSentence(detail.value))
    .filter((value): value is string => Boolean(value));

  if (values.length === 0) {
    return null;
  }

  return values.join(' ');
}

function normalizeDetailLabel(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

function readSentence(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
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
