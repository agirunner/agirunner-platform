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
  const focusLabel = normalizeDisplayText(overview.focusLabel) ?? 'Latest activity';
  const focusDetail =
    normalizeDisplayText(overview.focusDetail) ?? 'Latest activity is ready for operator review.';

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
            <div className="text-sm font-semibold text-foreground">{focusLabel}</div>
            <Badge variant={overview.focusTone}>{focusLabel}</Badge>
          </div>
          <p className="text-sm leading-6 text-muted">{focusDetail}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:w-[28rem]">
          {overview.metrics.map((metric) => (
            <div
              key={metric.label}
              className="grid gap-1 rounded-xl border border-border/70 bg-background/80 p-4"
            >
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                {normalizeDisplayText(metric.label) ?? 'Metric'}
              </div>
              <div className="text-sm font-semibold text-foreground">
                {normalizeDisplayText(metric.value) ?? '—'}
              </div>
              <div className="text-xs leading-5 text-muted">
                {normalizeDisplayText(metric.detail) ?? 'No operator detail available.'}
              </div>
            </div>
          ))}
        </div>
      </div>

      <ul className="grid gap-3" data-testid="work-item-history-list">
        {props.events.map((event) => {
          const packet = buildWorkItemHistoryPacket(event);
          const headline = normalizeDisplayText(packet.headline) ?? 'Recorded activity';
          const summary = normalizeDisplayText(packet.summary);
          const scopeSummary = normalizeDisplayText(packet.scopeSummary);
          const emphasisLabel = normalizeDisplayText(packet.emphasisLabel) ?? 'Activity';
          const signalBadges = normalizeDisplayList(packet.signalBadges);
          const stageName = normalizeDisplayText(packet.stageName);
          const actor = normalizeDisplayText(packet.actor);
          const workItemId = normalizeDisplayText(packet.workItemId);
          const taskId = normalizeDisplayText(packet.taskId);
          const createdAtLabel = normalizeDisplayText(packet.createdAtLabel) ?? 'recently';
          const createdAtTitle = normalizeDisplayText(packet.createdAtTitle) ?? createdAtLabel;
          return (
            <li
              key={packet.id}
              className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{headline}</strong>
                    <Badge variant={packet.emphasisTone}>{emphasisLabel}</Badge>
                  </div>
                  {summary ? <p className="text-sm leading-6 text-muted">{summary}</p> : null}
                  {scopeSummary ? (
                    <p className="text-xs leading-5 text-muted">{scopeSummary}</p>
                  ) : null}
                </div>
                <div className="text-xs text-muted" title={createdAtTitle}>
                  {createdAtLabel}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {signalBadges.map((badge) => (
                  <Badge key={`${packet.id}:${badge}`} variant="outline">
                    {badge}
                  </Badge>
                ))}
                {stageName ? <Badge variant="outline">{stageName}</Badge> : null}
                {actor ? <Badge variant="outline">{actor}</Badge> : null}
                {workItemId ? (
                  <Badge variant="outline">work item {workItemId.slice(0, 8)}</Badge>
                ) : null}
                {taskId ? <Badge variant="outline">step {taskId.slice(0, 8)}</Badge> : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {taskId ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/work/tasks/${taskId}`}>Open linked step</Link>
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

function normalizeDisplayList(values: readonly unknown[]): string[] {
  return values
    .map((value) => normalizeDisplayText(value))
    .filter((value): value is string => Boolean(value));
}

function normalizeDisplayText(value: unknown, depth = 0): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const entries = normalizeDisplayList(value);
    return entries.length > 0 ? entries.join(', ') : null;
  }
  const record = asRecord(value);
  if (depth < 2) {
    const preferredValues = [
      record.label,
      record.title,
      record.name,
      record.summary,
      record.message,
      record.id,
      record.count,
    ];
    for (const preferredValue of preferredValues) {
      const normalized = normalizeDisplayText(preferredValue, depth + 1);
      if (normalized) {
        return normalized;
      }
    }
  }
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return null;
  }
  return `Structured ${humanizeDisplayKey(keys[0])}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function humanizeDisplayKey(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (character) => character.toUpperCase());
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

  const reviewLabel = normalizeDisplayText(props.label) ?? 'Review packet';
  const reviewDetail =
    normalizeDisplayText(summary.detail) ?? 'Structured packet available for operator review.';
  const shapeLabel = normalizeDisplayText(summary.shapeLabel) ?? 'Structured packet';
  const scalarFacts = summary.scalarFacts
    .map((fact) => ({
      label: normalizeDisplayText(fact.label) ?? 'Field',
      value: normalizeDisplayText(fact.value) ?? 'Structured value',
    }))
    .filter((fact) => fact.label || fact.value);
  const keyHighlights = normalizeDisplayList(summary.keyHighlights);
  const disclosureLabel =
    normalizeDisplayText(props.disclosureLabel) ?? 'Open full payload';

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-background/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {reviewLabel}
          </div>
          <p className="text-sm leading-6 text-muted">{reviewDetail}</p>
        </div>
        <Badge variant="outline">{shapeLabel}</Badge>
      </div>
      {scalarFacts.length > 0 ? (
        <dl className="grid gap-2 sm:grid-cols-2">
          {scalarFacts.map((fact) => (
            <div
              key={`${reviewLabel}:${fact.label}`}
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
      {keyHighlights.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {keyHighlights.map((key) => (
            <Badge key={`${reviewLabel}:${key}`} variant="outline">
              {key}
            </Badge>
          ))}
        </div>
      ) : null}
      <details className="rounded-lg border border-border/70 bg-surface px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          {disclosureLabel}
        </summary>
        <div className="mt-3">
          <StructuredRecordView data={props.value} emptyMessage={props.emptyMessage} />
        </div>
      </details>
    </div>
  );
}
