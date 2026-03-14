import { useEffect, useMemo, useState } from 'react';
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
  buildTimelineRecords,
  filterAndSortTimelineRecords,
  filtersToSavedViewState,
  loadPersistedTimelineFilters,
  paginateTimelineRecords,
  persistTimelineFilters,
  savedViewStateToFilters,
  TIMELINE_PAGE_SIZE,
  totalTimelinePages,
  type TimelineRecord,
} from './workflow-history-card.filters.js';
import {
  type TimelineDescriptor,
  type TimelineLookupContext,
} from './workflow-history-card.narrative.js';
import { TimelineEventPacket } from './workflow-history-card.packet.js';
import {
  formatAbsoluteTimestamp,
  formatRelativeTimestamp,
} from './workflow-detail-presentation.js';
import {
  WorkItemHistoryFilterBar,
  WorkItemHistoryPagination,
} from './workflow-work-item-history-controls.js';
import { WorkflowSurfaceRecoveryState } from './workflow-surface-recovery-state.js';

export { buildTimelineContext, describeTimelineEvent } from './workflow-history-card.narrative.js';

export function WorkflowInteractionTimelineCard(props: {
  context: TimelineLookupContext;
  workflowId: string;
  isLoading: boolean;
  isLoadingMore?: boolean;
  hasError: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onRetry?: () => void;
  events: DashboardEventRecord[];
}) {
  const storageKey = `timeline:${props.workflowId}`;
  const [filters, setFilters] = useState(() =>
    loadPersistedTimelineFilters(storageKey),
  );
  const [page, setPage] = useState(0);

  useEffect(() => {
    setFilters(loadPersistedTimelineFilters(storageKey));
    setPage(0);
  }, [storageKey]);

  useEffect(() => {
    persistTimelineFilters(storageKey, filters);
  }, [filters, storageKey]);

  const records = useMemo(
    () => buildTimelineRecords(props.events, props.context),
    [props.events, props.context],
  );
  const filteredRecords = useMemo(
    () => filterAndSortTimelineRecords(records, filters),
    [filters, records],
  );
  const totalPages = useMemo(
    () => totalTimelinePages(filteredRecords.length, TIMELINE_PAGE_SIZE),
    [filteredRecords.length],
  );

  useEffect(() => {
    setPage(0);
  }, [filters.query, filters.signal, filters.sort]);

  useEffect(() => {
    setPage((currentPage) =>
      Math.min(currentPage, Math.max(0, totalPages - 1)),
    );
  }, [totalPages]);

  const visibleRecords = useMemo(
    () => paginateTimelineRecords(filteredRecords, page, TIMELINE_PAGE_SIZE),
    [filteredRecords, page],
  );
  const activeFilters = filtersToSavedViewState(filters);
  const hasActiveFilters = Object.keys(activeFilters).length > 0;

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
          <WorkflowSurfaceRecoveryState
            title="Workflow activity is unavailable"
            detail="The board timeline request did not complete, or this run has not published activity records yet. Retry the timeline before diagnosing operator or orchestrator behavior from this tab."
            onRetry={props.onRetry}
            actionLabel="Retry timeline"
          />
        ) : null}
        {props.events.length === 0 && !props.isLoading && !props.hasError ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
            No workflow activity recorded yet.
          </p>
        ) : null}
        {props.events.length > 0 && !props.isLoading ? (
          <>
            {props.hasMore ? (
              <div className="flex justify-start">
                <Button
                  type="button"
                  variant="outline"
                  onClick={props.onLoadMore}
                  disabled={props.isLoadingMore}
                >
                  {props.isLoadingMore
                    ? 'Loading older activity...'
                    : 'Load older activity'}
                </Button>
              </div>
            ) : null}
            <WorkItemHistoryFilterBar
              totalCount={props.events.length}
              visibleCount={filteredRecords.length}
              filters={filters}
              savedViewFilters={activeFilters}
              savedViewStorageKey={`timeline:${props.workflowId}`}
              onQueryChange={(value) =>
                setFilters((current) => ({ ...current, query: value }))
              }
              onSignalChange={(value) =>
                setFilters((current) => ({ ...current, signal: value }))
              }
              onSortChange={(value) =>
                setFilters((current) => ({ ...current, sort: value }))
              }
              onApplySavedView={(savedFilters) =>
                setFilters(savedViewStateToFilters(savedFilters))
              }
            />
            {filteredRecords.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
                {hasActiveFilters
                  ? 'No timeline events match the current filters. Adjust the saved view or filter bar to bring the relevant activity back into scope.'
                  : 'No timeline events are visible in this history slice.'}
              </p>
            ) : (
              <>
                <ol className="grid gap-4">
                  {visibleRecords.map((record) => (
                    <TimelineEntry
                      key={record.event.id}
                      workflowId={props.workflowId}
                      record={record}
                    />
                  ))}
                </ol>
                <WorkItemHistoryPagination
                  currentPage={page}
                  totalPages={totalPages}
                  visibleCount={filteredRecords.length}
                  pageSize={TIMELINE_PAGE_SIZE}
                  onPrevious={() =>
                    setPage((current) => Math.max(0, current - 1))
                  }
                  onNext={() =>
                    setPage((current) =>
                      Math.min(totalPages - 1, current + 1),
                    )
                  }
                />
              </>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TimelineEntry(props: {
  workflowId: string;
  record: TimelineRecord;
}) {
  const { descriptor, event } = props.record;
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
            <Badge variant={descriptor.emphasisTone}>
              {descriptor.emphasisLabel}
            </Badge>
            {descriptor.stageName ? (
              <Badge variant="outline">{descriptor.stageName}</Badge>
            ) : null}
            {descriptor.signalBadges.map((badge) => (
              <Badge key={`${event.id}:${badge}`} variant="outline">
                {badge}
              </Badge>
            ))}
          </div>
          <strong>{descriptor.narrativeHeadline}</strong>
          <span
            className="text-sm text-muted"
            title={formatAbsoluteTimestamp(event.created_at)}
          >
            {formatRelativeTimestamp(event.created_at)}
          </span>
        </div>
      </div>
      {descriptor.summary ? (
        <p className="text-sm text-muted">{descriptor.summary}</p>
      ) : null}
      {descriptor.outcomeLabel &&
      descriptor.outcomeLabel !== descriptor.summary ? (
        <p className="text-sm text-foreground">{descriptor.outcomeLabel}</p>
      ) : null}
      {descriptor.scopeSummary ? (
        <p className="text-xs leading-5 text-muted">
          {descriptor.scopeSummary}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        {actions.map((action) => (
          <Link
            key={`${event.id}:${action.label}`}
            to={action.href}
            className="underline-offset-4 hover:underline"
          >
            {action.label}
          </Link>
        ))}
      </div>
      <TimelineEventPacket event={event} descriptor={descriptor} />
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
