import { Link } from 'react-router-dom';

import type { DashboardEventRecord } from '../lib/api.js';
import { StructuredRecordView } from '../components/structured-data.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { summarizeStructuredValue } from './workflow-work-item-detail-support.js';
import {
  buildWorkItemHistoryOverview,
  buildWorkItemHistoryPacket,
} from './workflow-work-item-history-support.js';

const loadingTextClass =
  'rounded-lg border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted';
const errorTextClass =
  'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700';

export function WorkItemEventHistorySection(props: {
  isLoading: boolean;
  hasError: boolean;
  events: DashboardEventRecord[];
}): JSX.Element {
  if (props.isLoading) {
    return <p className={loadingTextClass}>Loading work-item history...</p>;
  }
  if (props.hasError) {
    return <p className={errorTextClass}>Failed to load work-item history.</p>;
  }
  if (props.events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
        No work-item events recorded yet.
      </div>
    );
  }

  const overview = buildWorkItemHistoryOverview(props.events);

  return (
    <section className="grid gap-4 rounded-xl border border-border/70 bg-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-1">
          <strong className="text-base">Event history</strong>
          <p className="text-sm leading-6 text-muted">
            Review operator-facing activity packets, then step into the linked specialist record only when you need deeper execution detail.
          </p>
        </div>
        <Badge variant="outline">{props.events.length} entries</Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-1 rounded-xl border border-border/70 bg-background/80 p-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Latest operator signal
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-foreground">{overview.focusLabel}</div>
            <Badge variant={overview.focusTone}>{overview.focusLabel}</Badge>
          </div>
          <p className="text-sm leading-6 text-muted">{overview.focusDetail}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:w-[28rem]">
          {overview.metrics.map((metric) => (
            <div
              key={metric.label}
              className="grid gap-1 rounded-xl border border-border/70 bg-background/80 p-4"
            >
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                {metric.label}
              </div>
              <div className="text-sm font-semibold text-foreground">{metric.value}</div>
              <div className="text-xs leading-5 text-muted">{metric.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <ul className="grid gap-3" data-testid="work-item-history-list">
        {props.events.map((event) => {
          const packet = buildWorkItemHistoryPacket(event);
          return (
            <li
              key={packet.id}
              className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{packet.headline}</strong>
                    <Badge variant={packet.emphasisTone}>{packet.emphasisLabel}</Badge>
                  </div>
                  {packet.summary ? <p className="text-sm leading-6 text-muted">{packet.summary}</p> : null}
                  {packet.scopeSummary ? (
                    <p className="text-xs leading-5 text-muted">{packet.scopeSummary}</p>
                  ) : null}
                </div>
                <div className="text-xs text-muted" title={packet.createdAtTitle}>
                  {packet.createdAtLabel}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {packet.signalBadges.map((badge) => (
                  <Badge key={`${packet.id}:${badge}`} variant="outline">
                    {badge}
                  </Badge>
                ))}
                {packet.stageName ? <Badge variant="outline">{packet.stageName}</Badge> : null}
                {packet.actor ? <Badge variant="outline">{packet.actor}</Badge> : null}
                {packet.workItemId ? (
                  <Badge variant="outline">work item {packet.workItemId.slice(0, 8)}</Badge>
                ) : null}
                {packet.taskId ? <Badge variant="outline">step {packet.taskId.slice(0, 8)}</Badge> : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {packet.taskId ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/work/tasks/${packet.taskId}`}>Open linked step</Link>
                  </Button>
                ) : null}
              </div>

              <StructuredValueReview
                label="Operator review packet"
                value={packet.payload}
                emptyMessage="No event payload."
                disclosureLabel="Open full event payload"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StructuredValueReview(props: {
  label: string;
  value: unknown;
  emptyMessage: string;
  disclosureLabel: string;
}): JSX.Element {
  const summary = summarizeStructuredValue(props.value);
  if (!summary.hasValue) {
    return <p className="text-sm leading-6 text-muted">{props.emptyMessage}</p>;
  }

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-background/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {props.label}
          </div>
          <p className="text-sm leading-6 text-muted">{summary.detail}</p>
        </div>
        <Badge variant="outline">{summary.shapeLabel}</Badge>
      </div>
      {summary.scalarFacts.length > 0 ? (
        <dl className="grid gap-2 sm:grid-cols-2">
          {summary.scalarFacts.map((fact) => (
            <div
              key={`${props.label}:${fact.label}`}
              className="grid gap-1 rounded-lg border border-border/70 bg-surface px-3 py-2"
            >
              <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                {fact.label}
              </dt>
              <dd className="text-sm text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {summary.keyHighlights.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {summary.keyHighlights.map((key) => (
            <Badge key={`${props.label}:${key}`} variant="outline">
              {key}
            </Badge>
          ))}
        </div>
      ) : null}
      <details className="rounded-lg border border-border/70 bg-surface px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          {props.disclosureLabel}
        </summary>
        <div className="mt-3">
          <StructuredRecordView data={props.value} emptyMessage={props.emptyMessage} />
        </div>
      </details>
    </div>
  );
}
