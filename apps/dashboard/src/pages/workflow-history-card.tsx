import { Link } from 'react-router-dom';

import type { DashboardEventRecord } from '../lib/api.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.js';
import { StructuredRecordView } from '../components/structured-data.js';
import {
  describeReviewPacket,
  toStructuredDetailViewData,
} from './workflow-detail-presentation.js';
import { readPacketScalarFacts } from './workflow-detail-support.js';

interface TimelineDescriptor {
  headline: string;
  summary: string | null;
  stageName: string | null;
  workItemId: string | null;
  taskId: string | null;
  actor: string | null;
}

export function WorkflowInteractionTimelineCard(props: {
  workflowId: string;
  isLoading: boolean;
  isLoadingMore?: boolean;
  hasError: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  events: DashboardEventRecord[];
}) {
  const events = sortEventsOldestFirst(props.events);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Interaction Timeline</CardTitle>
        <CardDescription>
          Human-readable orchestrator and operator activity for this board run.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.isLoading ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
            Loading timeline...
          </p>
        ) : null}
        {props.hasError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            Failed to load workflow activity.
          </p>
        ) : null}
        {events.length === 0 && !props.isLoading && !props.hasError ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
            No workflow activity recorded yet.
          </p>
        ) : null}
        {props.hasMore ? (
          <div className="flex justify-start">
            <Button
              type="button"
              variant="outline"
              onClick={props.onLoadMore}
              disabled={props.isLoadingMore}
            >
              {props.isLoadingMore ? 'Loading older activity...' : 'Load older activity'}
            </Button>
          </div>
        ) : null}
        <ol className="grid gap-4">
          {events.map((event) => (
            <TimelineEntry key={event.id} workflowId={props.workflowId} event={event} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export function describeTimelineEvent(event: DashboardEventRecord): TimelineDescriptor {
  const stageName = readString(event.data?.stage_name) ?? null;
  const workItemId = readString(event.data?.work_item_id) ?? null;
  const taskId = readString(event.data?.task_id) ?? null;
  const actor = readActorLabel(event.actor_type, event.actor_id);
  const workItemTitle =
    readString(event.data?.work_item_title) ??
    readString(event.data?.title) ??
    readString(event.data?.name) ??
    null;
  const taskTitle = readString(event.data?.task_title) ?? null;
  const childWorkflowName =
    readString(event.data?.child_workflow_name) ??
    readString(event.data?.child_name) ??
    null;
  const nextState = readString(event.data?.to_state) ?? readString(event.data?.state) ?? null;

  switch (event.type) {
    case 'workflow.created':
      return {
        headline: 'Board run created',
        summary: actor ? `Started by ${actor}.` : 'The board run was initialized.',
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'workflow.activation_queued':
      return {
        headline: 'Orchestrator wake-up queued',
        summary: readString(event.data?.reason) ?? 'A new activation batch was queued for the orchestrator.',
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'workflow.activation_started':
      return {
        headline: 'Orchestrator activation started',
        summary:
          readString(event.data?.activation_id) != null
            ? `Activation ${readString(event.data?.activation_id)} is processing queued workflow events.`
            : 'The orchestrator started processing queued workflow events.',
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'workflow.state_changed':
      return {
        headline: nextState ? `Workflow moved to ${humanizeToken(nextState)}` : 'Workflow state changed',
        summary: readString(event.data?.reason) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'workflow.completed':
      return {
        headline: 'Workflow completed',
        summary: readString(event.data?.summary) ?? 'All required workflow outcomes were delivered.',
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'workflow.cancelled':
      return {
        headline: 'Workflow cancelled',
        summary: readString(event.data?.reason) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'work_item.created':
      return {
        headline: workItemTitle ? `Created work item ${workItemTitle}` : 'Created work item',
        summary:
          readString(event.data?.goal) ??
          readString(event.data?.notes) ??
          'The orchestrator added new board work.',
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'work_item.updated':
      return {
        headline: workItemTitle ? `Updated work item ${workItemTitle}` : 'Updated work item',
        summary: readString(event.data?.summary) ?? readString(event.data?.notes) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'work_item.moved':
      return {
        headline: workItemTitle ? `Moved work item ${workItemTitle}` : 'Moved work item',
        summary: buildMovementSummary(event.data, stageName),
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'work_item.reparented':
      return {
        headline: workItemTitle ? `Reparented work item ${workItemTitle}` : 'Reparented work item',
        summary: readString(event.data?.parent_work_item_title) ?? 'The work item moved under a different milestone.',
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'work_item.completed':
      return {
        headline: workItemTitle ? `Completed work item ${workItemTitle}` : 'Completed work item',
        summary: readString(event.data?.summary) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'task.created':
      return {
        headline: taskTitle ? `Queued step ${taskTitle}` : 'Queued specialist step',
        summary: readString(event.data?.role) ?? readString(event.data?.assigned_role) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'task.completed':
      return {
        headline: taskTitle ? `Completed step ${taskTitle}` : 'Completed specialist step',
        summary: readString(event.data?.summary) ?? readString(event.data?.role) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'task.failed':
      return {
        headline: taskTitle ? `Step failed: ${taskTitle}` : 'Specialist step failed',
        summary: readString(event.data?.error) ?? readString(event.data?.message) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'task.escalated':
      return {
        headline: taskTitle ? `Escalated step ${taskTitle}` : 'Specialist step escalated',
        summary: readString(event.data?.reason) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'stage.started':
      return {
        headline: stageName ? `Started stage ${stageName}` : 'Started workflow stage',
        summary: readString(event.data?.goal) ?? readString(event.data?.summary) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'stage.completed':
      return {
        headline: stageName ? `Completed stage ${stageName}` : 'Completed workflow stage',
        summary: readString(event.data?.summary) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'stage.gate_requested':
      return {
        headline: stageName ? `Requested gate for ${stageName}` : 'Requested stage gate',
        summary: readString(event.data?.recommendation) ?? readString(event.data?.request_summary) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'stage.gate.approve':
    case 'stage.gate.reject':
    case 'stage.gate.request_changes':
      return {
        headline: stageName
          ? `${humanizeToken(event.type.replace('stage.gate.', ''))} gate for ${stageName}`
          : `${humanizeToken(event.type.replace('stage.gate.', ''))} stage gate`,
        summary: readString(event.data?.feedback) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'budget.warning':
      return {
        headline: 'Workflow budget warning',
        summary: buildBudgetSummary(event.data, 'warning'),
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'budget.exceeded':
      return {
        headline: 'Workflow budget exceeded',
        summary: buildBudgetSummary(event.data, 'exceeded'),
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'child_workflow.completed':
      return {
        headline: childWorkflowName ? `Child board completed: ${childWorkflowName}` : 'Child board completed',
        summary: readString(event.data?.summary) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
    case 'child_workflow.failed':
      return {
        headline: childWorkflowName ? `Child board failed: ${childWorkflowName}` : 'Child board failed',
        summary: readString(event.data?.error) ?? readString(event.data?.reason) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
    default:
      return {
        headline: humanizeToken(event.type),
        summary: readString(event.data?.summary) ?? readString(event.data?.reason) ?? null,
        stageName,
        workItemId,
        taskId,
        actor,
      };
  }
}

function TimelineEntry(props: { workflowId: string; event: DashboardEventRecord }) {
  const descriptor = describeTimelineEvent(props.event);

  return (
    <li className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{descriptor.headline}</strong>
            <Badge variant="outline">{humanizeToken(props.event.type)}</Badge>
            {descriptor.stageName ? <Badge variant="secondary">{descriptor.stageName}</Badge> : null}
          </div>
          <span className="text-sm text-muted">{formatTimestamp(props.event.created_at)}</span>
        </div>
        {descriptor.actor ? <Badge variant="outline">{descriptor.actor}</Badge> : null}
      </div>
      {descriptor.summary ? <p className="text-sm text-muted">{descriptor.summary}</p> : null}
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        {descriptor.workItemId ? (
          <Link to={`/work/workflows/${props.workflowId}?work_item=${descriptor.workItemId}`} className="underline-offset-4 hover:underline">
            Open work item
          </Link>
        ) : null}
        {descriptor.taskId ? (
          <Link to={`/work/tasks/${descriptor.taskId}`} className="underline-offset-4 hover:underline">
            Open step
          </Link>
        ) : null}
      </div>
      <TimelineEventPacket event={props.event} />
    </li>
  );
}

function TimelineEventPacket(props: { event: DashboardEventRecord }): JSX.Element {
  const reviewPacket = describeReviewPacket(props.event.data, 'interaction packet');
  const scalarFacts = readPacketScalarFacts(props.event.data, 4);

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-surface/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Interaction packet
          </div>
          <div className="text-sm font-medium text-foreground">{reviewPacket.summary}</div>
          <p className="text-sm leading-6 text-muted">{reviewPacket.detail}</p>
        </div>
        <Badge variant="outline">{reviewPacket.typeLabel}</Badge>
      </div>
      {scalarFacts.length > 0 ? (
        <dl className="grid gap-2 sm:grid-cols-2">
          {scalarFacts.map((fact) => (
            <div
              key={`${props.event.id}:${fact.label}`}
              className="grid gap-1 rounded-lg border border-border/70 bg-background/90 px-3 py-2"
            >
              <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                {fact.label}
              </dt>
              <dd className="text-sm text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {reviewPacket.badges.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {reviewPacket.badges.map((badge) => (
            <Badge key={`${props.event.id}:${badge}`} variant="outline">
              {badge}
            </Badge>
          ))}
        </div>
      ) : null}
      {reviewPacket.hasStructuredDetail ? (
        <details className="rounded-lg border border-border/60 bg-background/90 p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Open event packet
          </summary>
          <div className="mt-3">
            <StructuredRecordView
              data={toStructuredDetailViewData(props.event.data)}
              emptyMessage="No event payload."
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function buildMovementSummary(
  data: Record<string, unknown> | undefined,
  stageName: string | null,
): string | null {
  const columnLabel =
    readString(data?.column_label) ??
    readString(data?.to_column_label) ??
    readString(data?.column_id) ??
    readString(data?.to_column_id);
  if (columnLabel && stageName) {
    return `Moved to ${columnLabel} in ${stageName}.`;
  }
  if (columnLabel) {
    return `Moved to ${columnLabel}.`;
  }
  if (stageName) {
    return `Moved within ${stageName}.`;
  }
  return null;
}

function buildBudgetSummary(
  data: Record<string, unknown> | undefined,
  severity: 'warning' | 'exceeded',
): string {
  const dimensions = readStringArray(data?.dimensions);
  const segments: string[] = [];

  if (dimensions.includes('tokens')) {
    segments.push(
      buildBudgetSegment(
        'tokens',
        readNumber(data?.tokens_used),
        readNumber(data?.tokens_limit),
        formatInteger,
      ),
    );
  }
  if (dimensions.includes('cost')) {
    segments.push(
      buildBudgetSegment(
        'cost',
        readNumber(data?.cost_usd),
        readNumber(data?.cost_limit_usd),
        formatCurrency,
      ),
    );
  }
  if (dimensions.includes('duration')) {
    segments.push(
      buildBudgetSegment(
        'duration',
        readNumber(data?.elapsed_minutes),
        readNumber(data?.duration_limit_minutes),
        formatMinutes,
      ),
    );
  }

  if (segments.length === 0) {
    return severity === 'warning'
      ? 'Workflow activity is approaching a configured budget boundary.'
      : 'Workflow activity crossed a configured budget boundary.';
  }

  const prefix =
    severity === 'warning'
      ? 'Approaching configured workflow guardrails for '
      : 'Configured workflow guardrails were exceeded for ';
  return `${prefix}${segments.join('; ')}.`;
}

function buildBudgetSegment(
  label: string,
  used: number | null,
  limit: number | null,
  formatter: (value: number) => string,
): string {
  const formattedUsed = used === null ? 'unknown usage' : formatter(used);
  const formattedLimit = limit === null ? 'no cap' : formatter(limit);
  return `${label} (${formattedUsed} / ${formattedLimit})`;
}

function readActorLabel(type: string, id: string | null | undefined): string | null {
  const actorType = readString(type);
  const actorId = readString(id);
  if (!actorType && !actorId) {
    return null;
  }
  if (!actorType) {
    return actorId;
  }
  if (!actorId) {
    return actorType;
  }
  return `${actorType}:${actorId}`;
}

function readNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatMinutes(value: number): string {
  return `${value.toFixed(2)} min`;
}

function humanizeToken(value: string): string {
  return value.replaceAll('.', ' ').replaceAll('_', ' ');
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sortEventsOldestFirst(events: DashboardEventRecord[]): DashboardEventRecord[] {
  return [...events].sort((left, right) => left.created_at.localeCompare(right.created_at));
}
