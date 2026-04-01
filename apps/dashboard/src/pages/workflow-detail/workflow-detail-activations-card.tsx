import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';

import { dashboardApi, type DashboardWorkflowActivationRecord, type DashboardWorkflowState } from '../../lib/api.js';
import {
  CopyableIdBadge,
  OperatorStatusBadge,
  RelativeTimestamp,
} from '../../components/operator-display/operator-display.js';
import { StructuredRecordView } from '../../components/structured-data/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Textarea } from '../../components/ui/textarea.js';
import { buildWorkflowDiagnosticsHref } from '../workflows/workflows-page.support.js';
import { buildTaskDetailHref } from '../work-shared/work-href-support.js';
import {
  buildWorkflowDetailPermalink,
  isWorkflowDetailTargetHighlighted,
} from '../../app/routes/workflow-navigation.js';
import {
  describeReviewPacket,
  formatRelativeTimestamp,
  toStructuredDetailViewData,
} from './workflow-detail-presentation.js';
import { describeTimelineEvent } from './workflow-history-card.js';

const MANUAL_WORKFLOW_ACTIVATION_EVENT_TYPE = 'operator.manual_enqueue';
const MANUAL_WORKFLOW_ACTIVATION_SOURCE = 'workflow-detail-activations-card';

export function WorkflowActivationsCard(props: {
  workflowId: string;
  workflowState?: DashboardWorkflowState;
  activations: DashboardWorkflowActivationRecord[];
  isLoading: boolean;
  hasError: boolean;
  canEnqueueManualActivation?: boolean;
  selectedActivationId?: string | null;
  onSelectActivation?(activationId: string): void;
  onActivationQueued?(): Promise<unknown> | unknown;
}) {
  const location = useLocation();
  const [manualActivationReason, setManualActivationReason] = useState('');
  const [manualActivationMessage, setManualActivationMessage] = useState<string | null>(null);
  const [manualActivationError, setManualActivationError] = useState<string | null>(null);
  const processingCount = props.activations.filter((activation) =>
    ['processing', 'running', 'in_progress'].includes(activation.state),
  ).length;
  const needsAttentionCount = props.activations.filter((activation) =>
    activation.recovery_status ||
    activation.redispatched_task_id ||
    ['failed', 'stale', 'cancelled'].includes(activation.state),
  ).length;
  const recoveredCount = props.activations.filter(
    (activation) => Boolean(activation.recovery_status),
  ).length;
  const queuedEventCount = props.activations.reduce(
    (total, activation) => total + (activation.event_count ?? activation.events?.length ?? 1),
    0,
  );
  const enqueueManualActivationMutation = useMutation({
    mutationFn: async () => {
      const reason = manualActivationReason.trim();
      if (!reason) {
        throw new Error('Activation reason is required.');
      }
      return dashboardApi.enqueueWorkflowActivation(props.workflowId, {
        reason,
        event_type: MANUAL_WORKFLOW_ACTIVATION_EVENT_TYPE,
        payload: {
          source: MANUAL_WORKFLOW_ACTIVATION_SOURCE,
          workflow_state: props.workflowState ?? 'active',
        },
      });
    },
    onSuccess: async () => {
      setManualActivationReason('');
      setManualActivationError(null);
      setManualActivationMessage('Queued operator wake-up for the orchestrator.');
      await props.onActivationQueued?.();
    },
    onError: (error) => {
      setManualActivationMessage(null);
      setManualActivationError(
        error instanceof Error ? error.message : 'Failed to queue workflow activation.',
      );
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orchestrator Activations</CardTitle>
        <CardDescription>
          Queued and completed orchestrator activations for this board run.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.isLoading ? <p className="text-sm text-muted">Loading activations...</p> : null}
        {props.hasError ? <p className="text-sm text-red-600">Failed to load activations.</p> : null}
        {props.canEnqueueManualActivation ? (
          <div className="grid gap-4 rounded-2xl border border-border/70 bg-gradient-to-br from-surface via-surface to-border/10 p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm text-foreground">Manual Wake-Up</strong>
                  <Badge variant="secondary">Operator control</Badge>
                </div>
                <p className="text-sm text-muted">
                  Queue an operator-requested orchestrator activation when the board needs another
                  management pass outside the normal event flow.
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/90 px-3 py-2 text-right shadow-sm">
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
                  Event Type
                </p>
                <p className="text-sm font-medium text-foreground">
                  {MANUAL_WORKFLOW_ACTIVATION_EVENT_TYPE}
                </p>
              </div>
            </div>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-foreground">Operator reason</span>
              <Textarea
                value={manualActivationReason}
                onChange={(event) => {
                  setManualActivationReason(event.target.value);
                  setManualActivationError(null);
                  setManualActivationMessage(null);
                }}
                rows={3}
                placeholder="Explain what changed or what the orchestrator should reassess."
              />
            </label>
            {manualActivationError ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                {manualActivationError}
              </p>
            ) : null}
            {manualActivationMessage ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                {manualActivationMessage}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Use this when workflow state changed outside the queue and the board still needs
                orchestrator attention.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => enqueueManualActivationMutation.mutate()}
                disabled={
                  enqueueManualActivationMutation.isPending ||
                  manualActivationReason.trim().length === 0
                }
              >
                {enqueueManualActivationMutation.isPending
                  ? 'Queueing activation...'
                  : 'Queue activation'}
              </Button>
            </div>
          </div>
        ) : null}
        {props.activations.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ActivationMetric label="Activation batches" value={String(props.activations.length)} />
            <ActivationMetric label="In flight" value={String(processingCount)} />
            <ActivationMetric label="Needs attention" value={String(needsAttentionCount)} />
            <ActivationMetric label="Queued events" value={String(queuedEventCount)} />
          </div>
        ) : null}
        <div className="grid gap-4">
          {props.activations.map((activation) => {
            const descriptor = describeActivationEvent(
              activation.workflow_id,
              activation.activation_id ?? activation.id,
              activation.event_type,
              activation.payload,
              activation.reason,
              activation.queued_at,
            );
            const payloadPacket = describeReviewPacket(activation.payload, 'activation payload');
            return (
              <article
                key={activation.id}
                id={`activation-${activation.activation_id ?? activation.id}`}
                className="grid gap-3 rounded-lg border border-border/70 bg-border/10 p-4"
                tabIndex={-1}
                data-workflow-focus-anchor="true"
                aria-labelledby={`activation-heading-${activation.id}`}
                data-highlighted={
                  props.selectedActivationId === (activation.activation_id ?? activation.id) ||
                  isWorkflowDetailTargetHighlighted(
                    location.search,
                    location.hash,
                    'activation',
                    activation.activation_id ?? activation.id,
                  )
                    ? 'true'
                    : 'false'
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <strong id={`activation-heading-${activation.id}`}>{descriptor.headline}</strong>
                    <p className="text-sm text-muted">
                      {activation.summary?.trim() || descriptor.summary || 'Activation packet ready for operator review.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <OperatorStatusBadge status={activation.state} />
                    <Badge variant="outline">{payloadPacket.typeLabel}</Badge>
                  </div>
                </div>
                {descriptor.scope ? <p className="text-sm text-muted">{descriptor.scope}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {activation.event_count ?? activation.events?.length ?? 1} events
                  </Badge>
                  <RelativeTimestamp
                    value={activation.queued_at}
                    prefix="Queued"
                    className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1"
                  />
                  {activation.recovery_status ? (
                    <OperatorStatusBadge status={activation.recovery_status} variant="outline" />
                  ) : null}
                  {recoveredCount > 0 && activation.recovery_status ? (
                    <Badge variant="secondary">Recovered flow</Badge>
                  ) : null}
                </div>
                {describeActivationRecovery(activation) ? (
                  <div className="grid gap-2 rounded-xl border border-amber-300/70 bg-amber-50/80 p-4 dark:border-amber-900/70 dark:bg-amber-950/20">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <strong className="text-sm text-foreground">Activation attention</strong>
                      <Badge variant="warning">Recovery signal</Badge>
                    </div>
                    <p className="text-sm text-muted">{describeActivationRecovery(activation)}</p>
                  </div>
                ) : null}
                <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4">
                  <div className="grid gap-2">
                    <div className="text-sm font-semibold text-foreground">{payloadPacket.summary}</div>
                    <p className="text-sm leading-6 text-muted">{payloadPacket.detail}</p>
                  </div>
                  {payloadPacket.badges.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {payloadPacket.badges.map((badge) => (
                        <Badge key={badge} variant="outline">
                          {badge}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {payloadPacket.hasStructuredDetail ? (
                    <details className="rounded-lg border border-border/70 bg-surface/70 p-3">
                      <summary className="cursor-pointer text-sm font-medium text-foreground">
                        Open activation payload
                      </summary>
                      <div className="mt-3">
                        <StructuredRecordView
                          data={toStructuredDetailViewData(activation.payload)}
                          emptyMessage="No activation payload."
                        />
                      </div>
                    </details>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      props.onSelectActivation?.(activation.activation_id ?? activation.id)
                    }
                  >
                    Highlight activation
                  </Button>
                  <CopyableIdBadge value={activation.activation_id ?? activation.id} label="Activation" />
                  <Link
                    to={buildWorkflowDiagnosticsHref({
                      workflowId: activation.workflow_id,
                      taskId: activation.redispatched_task_id ?? null,
                      view: 'summary',
                    })}
                    className="text-sm text-muted underline-offset-4 hover:underline"
                  >
                    Open inspector
                  </Link>
                  {activation.redispatched_task_id ? (
                    <Link
                      to={buildTaskDetailHref(activation.redispatched_task_id)}
                      className="text-sm text-muted underline-offset-4 hover:underline"
                    >
                      Redispatched task
                    </Link>
                  ) : null}
                  <Link
                    to={buildWorkflowDetailPermalink(activation.workflow_id, {
                      activationId: activation.activation_id ?? activation.id,
                    })}
                    className="text-sm text-muted underline-offset-4 hover:underline"
                  >
                    Permalink
                  </Link>
                </div>
                {activation.events && activation.events.length > 0 ? (
                  <details className="rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm">
                    <summary className="cursor-pointer text-sm font-medium text-foreground">
                      Open event batch ({activation.events.length})
                    </summary>
                    <ul className="mt-4 grid gap-3">
                      {activation.events.map((event) => {
                        const eventDescriptor = describeActivationEvent(
                          activation.workflow_id,
                          activation.activation_id ?? activation.id,
                          event.event_type,
                          event.payload,
                          event.reason,
                          event.queued_at,
                        );
                        const eventPayloadPacket = describeReviewPacket(
                          event.payload,
                          'activation event payload',
                        );
                        return (
                          <li key={event.id} className="grid gap-2 rounded-md border border-border/60 bg-surface/70 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="grid gap-1">
                                <strong>{eventDescriptor.headline}</strong>
                                <p className="text-sm text-muted">
                                  {event.summary?.trim() || eventDescriptor.summary || 'Activation event packet available.'}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <OperatorStatusBadge status={event.state} />
                                <Badge variant="outline">{eventPayloadPacket.typeLabel}</Badge>
                              </div>
                            </div>
                            {eventDescriptor.scope ? <p className="text-sm text-muted">{eventDescriptor.scope}</p> : null}
                            <div className="flex flex-wrap gap-2">
                              <CopyableIdBadge value={event.id} label="Event" />
                              <RelativeTimestamp
                                value={event.queued_at}
                                prefix="Queued"
                                className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1"
                              />
                            </div>
                            <div className="grid gap-2 rounded-lg border border-border/70 bg-background/80 p-3">
                              <div className="text-sm font-medium text-foreground">
                                {eventPayloadPacket.summary}
                              </div>
                              <p className="text-sm leading-6 text-muted">{eventPayloadPacket.detail}</p>
                              {eventPayloadPacket.badges.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {eventPayloadPacket.badges.map((badge) => (
                                    <Badge key={badge} variant="outline">
                                      {badge}
                                    </Badge>
                                  ))}
                                </div>
                              ) : null}
                              {eventPayloadPacket.hasStructuredDetail ? (
                                <details className="rounded-lg border border-border/70 bg-surface/70 p-3">
                                  <summary className="cursor-pointer text-sm font-medium text-foreground">
                                    Open event payload
                                  </summary>
                                  <div className="mt-3">
                                    <StructuredRecordView
                                      data={toStructuredDetailViewData(event.payload)}
                                      emptyMessage="No activation payload."
                                    />
                                  </div>
                                </details>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ) : null}
              </article>
            );
          })}
          {props.activations.length === 0 && !props.isLoading && !props.hasError ? (
            <p className="text-sm text-muted">No workflow activations recorded yet.</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function describeActivationRecovery(activation: DashboardWorkflowActivationRecord): string | null {
  const details: string[] = [];
  if (activation.recovery_status) {
    details.push(`Recovery ${activation.recovery_status}`);
  }
  if (activation.recovery_reason) {
    details.push(activation.recovery_reason);
  }
  if (activation.stale_started_at) {
    details.push(`stale since ${formatRelativeTimestamp(activation.stale_started_at)}`);
  }
  if (activation.recovery_detected_at) {
    details.push(`detected ${formatRelativeTimestamp(activation.recovery_detected_at)}`);
  }
  if (activation.redispatched_task_id) {
    details.push(`redispatched via task ${activation.redispatched_task_id}`);
  }
  return details.length > 0 ? details.join(' • ') : null;
}

function ActivationMetric(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid gap-1 rounded-xl border border-border/70 bg-background/90 p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
        {props.label}
      </p>
      <strong className="text-xl text-foreground">{props.value}</strong>
    </div>
  );
}

function describeActivationEvent(
  workflowId: string,
  activationId: string,
  eventType: string,
  payload: unknown,
  reason: string | null | undefined,
  queuedAt: string,
): {
  headline: string;
  summary: string | null;
  scope: string | null;
} {
  if (eventType === MANUAL_WORKFLOW_ACTIVATION_EVENT_TYPE) {
    return {
      headline: 'Operator wake-up queued',
      summary: reason ?? 'Operator-requested activation queued for orchestrator review.',
      scope: null,
    };
  }
  const descriptor = describeTimelineEvent({
    id: `${activationId}:${eventType}:${queuedAt}`,
    type: eventType,
    entity_type: 'workflow',
    entity_id: workflowId,
    actor_type: 'system',
    actor_id: null,
    data: asActivationPayload(payload),
    created_at: queuedAt,
  });
  return {
    headline: descriptor.headline,
    summary: reason ?? descriptor.summary,
    scope: describeActivationScope(descriptor.stageName, descriptor.workItemId, descriptor.taskId),
  };
}

function describeActivationScope(
  stageName: string | null,
  workItemId: string | null,
  taskId: string | null,
): string | null {
  const parts: string[] = [];
  if (stageName) {
    parts.push(`Stage ${stageName}`);
  }
  if (workItemId) {
    parts.push(`Work item ${workItemId.slice(0, 8)}`);
  }
  if (taskId) {
    parts.push(`Task ${taskId.slice(0, 8)}`);
  }
  return parts.length > 0 ? parts.join(' • ') : null;
}

function asActivationPayload(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
