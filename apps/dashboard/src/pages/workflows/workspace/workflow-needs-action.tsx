import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import { Textarea } from '../../../components/ui/textarea.js';
import type {
  DashboardWorkflowNeedsActionItem,
  DashboardWorkflowNeedsActionPacket,
  DashboardWorkflowNeedsActionResponseAction,
} from '../../../lib/api.js';
import { toast } from '../../../lib/toast.js';
import { invalidateWorkflowsQueries } from '../workflows-query.js';
import {
  buildNeedsActionDossier,
  buildNeedsActionScopeLine,
  buildPromptMeta,
  describeNeedsActionVisibleTargetKind,
  humanizeToken,
  isVisibleNeedsActionResponse,
  normalizeNeedsActionScope,
  readScopedAwayWorkflowMessage,
  readSuccessMessage,
  runNeedsAction,
  shouldDisplayNeedsActionItem,
} from './workflow-needs-action.support.js';

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
              scopeLine={buildNeedsActionScopeLine(scopeSubject, normalizedScope.label, item)}
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
  scopeLine: string | null;
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
      {props.scopeLine ? <p className="text-sm text-muted-foreground">{props.scopeLine}</p> : null}

      <DossierSection title="Needs decision" value={dossier.needsDecision} />
      <DossierSection title="Why it needs action" value={dossier.whyItNeedsAction} />
      <DossierSection title="Blocking now" value={dossier.blockingNow} />
      <DossierSection title="Work so far" value={dossier.workSoFar} />
      <DossierSection title="Recommended action" value={dossier.recommendedAction} />
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
      <p className="text-xs font-medium text-muted-foreground">{props.title}</p>
      <p className="text-sm leading-6 text-foreground">{props.value}</p>
    </div>
  );
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
