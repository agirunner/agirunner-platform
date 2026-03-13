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
import { buildTimelineEntryActions } from './workflow-history-card.actions.js';
import {
  describeTimelineEvent,
  type TimelineDescriptor,
  type TimelineLookupContext,
} from './workflow-history-card.narrative.js';
import { TimelineEventPacket } from './workflow-history-card.packet.js';

export { buildTimelineContext, describeTimelineEvent } from './workflow-history-card.narrative.js';

export function WorkflowInteractionTimelineCard(props: {
  context: TimelineLookupContext;
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
            <TimelineEntry
              key={event.id}
              context={props.context}
              workflowId={props.workflowId}
              event={event}
            />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
function TimelineEntry(props: {
  context: TimelineLookupContext;
  workflowId: string;
  event: DashboardEventRecord;
}) {
  const descriptor = describeTimelineEvent(props.event, props.context);
  const actions = buildTimelineEntryActions({
    activationId: descriptor.activationId,
    childWorkflowHref: descriptor.childWorkflowHref,
    childWorkflowId: descriptor.childWorkflowId,
    gateStageName: descriptor.gateStageName,
    workflowId: props.workflowId,
    workItemId: descriptor.workItemId,
    taskId: descriptor.taskId,
  });

  return (
    <li className={timelineEntryClassName(descriptor.emphasisTone)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{descriptor.actorLabel}</Badge>
            <Badge variant={descriptor.emphasisTone}>{descriptor.emphasisLabel}</Badge>
            {descriptor.stageName ? <Badge variant="outline">{descriptor.stageName}</Badge> : null}
            {descriptor.signalBadges.map((badge) => (
              <Badge key={`${props.event.id}:${badge}`} variant="outline">
                {badge}
              </Badge>
            ))}
          </div>
          <strong>{descriptor.narrativeHeadline}</strong>
          <span className="text-sm text-muted">{formatTimestamp(props.event.created_at)}</span>
        </div>
      </div>
      {descriptor.summary ? <p className="text-sm text-muted">{descriptor.summary}</p> : null}
      {descriptor.outcomeLabel && descriptor.outcomeLabel !== descriptor.summary ? (
        <p className="text-sm text-foreground">{descriptor.outcomeLabel}</p>
      ) : null}
      {descriptor.scopeSummary ? (
        <p className="text-xs leading-5 text-muted">{descriptor.scopeSummary}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        {actions.map((action) => (
          <Link
            key={`${props.event.id}:${action.label}`}
            to={action.href}
            className="underline-offset-4 hover:underline"
          >
            {action.label}
          </Link>
        ))}
      </div>
      <TimelineEventPacket event={props.event} />
    </li>
  );
}

function timelineEntryClassName(
  tone: TimelineDescriptor['emphasisTone'],
): string {
  if (tone === 'destructive') {
    return 'grid gap-3 rounded-xl border border-red-200 bg-red-50/70 p-4 shadow-sm dark:border-red-900/70 dark:bg-red-950/20';
  }
  if (tone === 'warning') {
    return 'grid gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm dark:border-amber-900/70 dark:bg-amber-950/20';
  }
  return 'grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm';
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function sortEventsOldestFirst(events: DashboardEventRecord[]): DashboardEventRecord[] {
  return [...events].sort((left, right) => left.created_at.localeCompare(right.created_at));
}
