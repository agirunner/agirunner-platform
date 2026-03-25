import { Link } from 'react-router-dom';

import { StructuredRecordView } from '../../components/structured-data/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { summarizeStructuredValue } from './workflow-work-item-detail-support.js';
import type { WorkItemHistoryPacket } from './workflow-work-item-history-support.js';

export function WorkItemHistoryEntry(props: {
  packet: WorkItemHistoryPacket;
}): JSX.Element {
  const headline = normalizeDisplayText(props.packet.headline) ?? 'Recorded activity';
  const summary = normalizeDisplayText(props.packet.summary);
  const scopeSummary = normalizeDisplayText(props.packet.scopeSummary);
  const emphasisLabel = normalizeDisplayText(props.packet.emphasisLabel) ?? 'Activity';
  const signalBadges = normalizeDisplayList(props.packet.signalBadges);
  const stageName = normalizeDisplayText(props.packet.stageName);
  const actor = normalizeDisplayText(props.packet.actor);
  const workItemId = normalizeDisplayText(props.packet.workItemId);
  const taskId = normalizeDisplayText(props.packet.taskId);
  const createdAtLabel = normalizeDisplayText(props.packet.createdAtLabel) ?? 'recently';
  const createdAtTitle = normalizeDisplayText(props.packet.createdAtTitle) ?? createdAtLabel;

  return (
    <li className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{headline}</strong>
            <Badge variant={props.packet.emphasisTone}>{emphasisLabel}</Badge>
          </div>
          {summary ? <p className="text-sm leading-6 text-muted">{summary}</p> : null}
          {scopeSummary ? <p className="text-xs leading-5 text-muted">{scopeSummary}</p> : null}
        </div>
        <div className="text-xs text-muted" title={createdAtTitle}>
          {createdAtLabel}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {signalBadges.map((badge) => (
          <Badge key={`${props.packet.id}:${badge}`} variant="outline">
            {badge}
          </Badge>
        ))}
        {stageName ? <Badge variant="outline">{stageName}</Badge> : null}
        {actor ? <Badge variant="outline">{actor}</Badge> : null}
        {workItemId ? <Badge variant="outline">work item {workItemId.slice(0, 8)}</Badge> : null}
        {taskId ? <Badge variant="outline">step {taskId.slice(0, 8)}</Badge> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {taskId ? (
          <>
            <p className="w-full text-xs leading-5 text-muted">
              Stay in the work-item flow first. Open linked step diagnostics only when you need the lower-level specialist trace behind this event.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to={`/mission-control/tasks/${taskId}`}>Open linked step diagnostics</Link>
            </Button>
          </>
        ) : null}
      </div>

      <StructuredValueReview
        label="Operator decision packet"
        value={props.packet.payload}
        emptyMessage="No event payload."
        disclosureLabel="Open full event payload"
      />
    </li>
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

  const reviewLabel = normalizeDisplayText(props.label) ?? 'Decision packet';
  const reviewDetail =
    normalizeDisplayText(summary.detail) ?? 'Structured packet available for operator inspection.';
  const shapeLabel = normalizeDisplayText(summary.shapeLabel) ?? 'Structured packet';
  const scalarFacts = summary.scalarFacts
    .map((fact) => ({
      label: normalizeDisplayText(fact.label) ?? 'Field',
      value: normalizeDisplayText(fact.value) ?? 'Structured value',
    }))
    .filter((fact) => fact.label || fact.value);
  const keyHighlights = normalizeDisplayList(summary.keyHighlights);
  const disclosureLabel = normalizeDisplayText(props.disclosureLabel) ?? 'Open full payload';

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
    for (const preferredValue of [
      record.label,
      record.title,
      record.name,
      record.summary,
      record.message,
      record.id,
      record.count,
    ]) {
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
