import { Link } from 'react-router-dom';

import type {
  DashboardTaskHandoffRecord,
  DashboardWorkItemMemoryEntry,
  DashboardWorkItemMemoryHistoryEntry,
  DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import { buildArtifactPermalink } from '../artifact-preview/artifact-preview-support.js';
import {
  CopyableIdBadge,
  RelativeTimestamp,
} from '../../components/operator-display/operator-display.js';
import { StructuredRecordView } from '../../components/structured-data/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import {
  describeCountLabel,
  describeWorkItemArtifactIdentity,
  summarizeStructuredValue,
  type DashboardWorkItemArtifactRecord,
  type DashboardWorkItemTaskRecord,
} from './workflow-work-item-detail-support.js';

const sectionFrameClass = 'rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm';
const metaRowClass = 'flex flex-wrap items-center gap-2';
const mutedBodyClass = 'text-sm leading-6 text-muted';
const loadingTextClass =
  'rounded-lg border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted';
const errorTextClass = 'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700';

export function WorkItemMemorySection(props: {
  isLoading: boolean;
  hasError: boolean;
  entries: DashboardWorkItemMemoryEntry[];
  history: DashboardWorkItemMemoryHistoryEntry[];
  isHistoryLoading: boolean;
  hasHistoryError: boolean;
}): JSX.Element {
  if (props.isLoading) {
    return <p className={loadingTextClass}>Loading work-item memory...</p>;
  }
  if (props.hasError) {
    return <p className={errorTextClass}>Failed to load work-item memory.</p>;
  }

  return (
    <div className="grid gap-4">
      <section className="grid gap-3 rounded-xl border border-border/70 bg-surface p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-base">Current memory</strong>
          <Badge variant="outline">{describeCountLabel(props.entries.length, 'entry')}</Badge>
        </div>
        {props.entries.length === 0 ? (
          <MemoryEmptyState
            title="No scoped memory yet"
            badge="Waiting for first write"
            summary="This work item has not stored any scoped memory packets yet."
            detail="Current memory shows the latest saved value for each key after the orchestrator or linked steps write scoped context."
          />
        ) : (
          props.entries.map((entry) => (
            <article
              key={`${entry.key}:${entry.event_id}`}
              className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <strong>{entry.key}</strong>
                <Badge variant="outline">{entry.stage_name ?? 'work item scope'}</Badge>
              </div>
              <div className={metaRowClass}>
                <Badge variant="outline">{entry.actor_type}</Badge>
                {entry.task_id ? <CopyableIdBadge value={entry.task_id} label="Step" /> : null}
                <RelativeTimestamp value={entry.updated_at} prefix="Updated" />
              </div>
              <StructuredValueReview
                label="Memory packet"
                value={entry.value}
                emptyMessage="No memory payload."
                disclosureLabel="Open full memory packet"
              />
            </article>
          ))
        )}
      </section>

      <section className="grid gap-3 rounded-xl border border-border/70 bg-surface p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-base">Memory history</strong>
          <Badge variant="outline">{describeCountLabel(props.history.length, 'event')}</Badge>
        </div>
        {props.isHistoryLoading ? (
          <p className={loadingTextClass}>Loading memory history...</p>
        ) : null}
        {props.hasHistoryError ? (
          <p className={errorTextClass}>Failed to load work-item memory history.</p>
        ) : null}
        {!props.isHistoryLoading && !props.hasHistoryError && props.history.length === 0 ? (
          <MemoryEmptyState
            title="No memory changes yet"
            badge="No history events"
            summary="There are no recorded create, update, or delete events for work-item memory yet."
            detail="History preserves each write in order so operators can reconstruct how the memory packet changed over time."
          />
        ) : null}
        {!props.isHistoryLoading && !props.hasHistoryError
          ? props.history.map((entry) => (
              <article
                key={`history:${entry.event_id}`}
                className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <strong>{entry.key}</strong>
                  <Badge variant={entry.event_type === 'deleted' ? 'secondary' : 'outline'}>
                    {formatMemoryHistoryEventType(entry.event_type)}
                  </Badge>
                </div>
                <div className={metaRowClass}>
                  <Badge variant="outline">{entry.actor_type}</Badge>
                  {entry.stage_name ? <Badge variant="outline">{entry.stage_name}</Badge> : null}
                  {entry.task_id ? <CopyableIdBadge value={entry.task_id} label="Step" /> : null}
                  <RelativeTimestamp value={entry.updated_at} prefix="Updated" />
                </div>
                <StructuredValueReview
                  label="Memory change packet"
                  value={entry.value}
                  emptyMessage="No memory payload."
                  disclosureLabel="Open full change packet"
                />
              </article>
            ))
          : null}
      </section>
    </div>
  );
}

export function WorkItemContinuitySection(props: {
  workItem: DashboardWorkflowWorkItemRecord | null | undefined;
  latestHandoff: DashboardTaskHandoffRecord | null;
  handoffCount: number;
  isLoading: boolean;
}): JSX.Element {
  const continuityFacts = [
    {
      label: 'Current stage',
      value: props.workItem?.stage_name ?? 'Not set',
    },
    {
      label: 'Next expected actor',
      value: props.workItem?.next_expected_actor ?? 'Not set',
    },
    {
      label: 'Next expected action',
      value: props.workItem?.next_expected_action ?? 'Not set',
    },
    {
      label: 'Rework count',
      value: String(props.workItem?.rework_count ?? 0),
    },
    {
      label: 'Subject revision',
      value: String(props.workItem?.current_subject_revision ?? 0),
    },
    {
      label: 'Assessment status',
      value: props.workItem?.assessment_status ?? 'Not set',
    },
    {
      label: 'Gate status',
      value: props.workItem?.gate_status ?? 'Not set',
    },
    {
      label: 'Blocked posture',
      value: props.workItem?.blocked_state ?? 'Clear',
    },
    {
      label: 'Blocked reason',
      value: props.workItem?.blocked_reason ?? 'None',
    },
    {
      label: 'Escalation',
      value: props.workItem?.escalation_status ?? 'Clear',
    },
    {
      label: 'Branch',
      value:
        props.workItem?.branch_id && props.workItem?.branch_status
          ? `${props.workItem.branch_status} • ${props.workItem.branch_id}`
          : props.workItem?.branch_status ?? 'Not branched',
    },
  ];

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <article className={sectionFrameClass}>
        <div className="grid gap-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Current continuity
          </div>
          <strong className="text-base text-foreground">What the platform expects next</strong>
          <p className={mutedBodyClass}>
            This is the persisted continuity state the orchestrator uses between activations.
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {continuityFacts.map((fact) => (
            <div
              key={fact.label}
              className="rounded-lg border border-border/70 bg-background/80 p-3"
            >
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                {fact.label}
              </div>
              <div className="mt-1 text-sm text-foreground">{fact.value}</div>
            </div>
          ))}
        </div>
      </article>
      <article className={sectionFrameClass}>
        <div className="grid gap-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Latest handoff
          </div>
          <strong className="text-base text-foreground">Most recent specialist handoff</strong>
          <p className={mutedBodyClass}>
            Structured handoffs preserve what changed, what remains, and what the next actor should
            inspect.
          </p>
        </div>
        {props.isLoading ? (
          <p className="mt-4 text-sm text-muted">Loading latest handoff...</p>
        ) : props.latestHandoff ? (
          <div className="mt-4 grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{props.latestHandoff.role}</Badge>
              {props.latestHandoff.stage_name ? (
                <Badge variant="outline">{props.latestHandoff.stage_name}</Badge>
              ) : null}
              <Badge variant="secondary">{props.latestHandoff.completion}</Badge>
              {props.latestHandoff.role_data?.resolution || props.latestHandoff.role_data?.decision_state ? (
                <Badge variant="outline">
                  {String(
                    props.latestHandoff.role_data?.decision_state ??
                      props.latestHandoff.role_data?.resolution,
                  ).replaceAll('_', ' ')}
                </Badge>
              ) : null}
              <Badge variant="outline">{props.handoffCount} handoffs</Badge>
            </div>
            <p className="text-sm leading-6 text-foreground">{props.latestHandoff.summary}</p>
            {props.latestHandoff.successor_context ? (
              <div className="rounded-lg border border-border/70 bg-background/80 p-3 text-sm text-muted">
                <div className="font-medium text-foreground">Successor context</div>
                <p className="mt-1 leading-6">{props.latestHandoff.successor_context}</p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 text-xs text-muted">
              <RelativeTimestamp value={props.latestHandoff.created_at} prefix="Submitted" />
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-border/70 bg-background/80 px-4 py-5 text-sm text-muted">
            No handoff recorded yet.
          </div>
        )}
      </article>
    </section>
  );
}

export function WorkItemHandoffHistorySection(props: {
  handoffs: DashboardTaskHandoffRecord[];
  isLoading: boolean;
}): JSX.Element {
  return (
    <section className={sectionFrameClass}>
      <div className="grid gap-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          Handoff history
        </div>
        <strong className="text-base text-foreground">
          Full execution chain for this work item
        </strong>
        <p className={mutedBodyClass}>
          Review the complete handoff trail when you need to see how work moved between specialists,
          what changed, and what still needs attention.
        </p>
      </div>
      {props.isLoading ? (
        <p className="mt-4 text-sm text-muted">Loading handoff history...</p>
      ) : props.handoffs.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {props.handoffs.map((handoff, index) => (
            <article
              key={handoff.id}
              className="rounded-lg border border-border/70 bg-background/80 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Step {index + 1}</Badge>
                <Badge variant="outline">{handoff.role}</Badge>
                {handoff.stage_name ? <Badge variant="outline">{handoff.stage_name}</Badge> : null}
                <Badge variant="secondary">{handoff.completion}</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-foreground">{handoff.summary}</p>
              {handoff.successor_context ? (
                <div className="mt-3 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm text-muted">
                  <div className="font-medium text-foreground">Successor context</div>
                  <p className="mt-1 leading-6">{handoff.successor_context}</p>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                <Badge variant="outline">
                  {describeCountLabel(handoff.focus_areas.length, 'assessment focus item')}
                </Badge>
                <Badge variant="outline">
                  {describeCountLabel(handoff.remaining_items.length, 'remaining item')}
                </Badge>
                <Badge variant="outline">
                  {describeCountLabel(handoff.blockers.length, 'blocker')}
                </Badge>
                <RelativeTimestamp value={handoff.created_at} prefix="Submitted" />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border/70 bg-background/80 px-4 py-5 text-sm text-muted">
          No handoff history recorded yet.
        </div>
      )}
    </section>
  );
}

export function WorkItemArtifactsSection(props: {
  isLoading: boolean;
  hasError: boolean;
  tasks: DashboardWorkItemTaskRecord[];
  artifacts: DashboardWorkItemArtifactRecord[];
}): JSX.Element {
  if (props.isLoading) {
    return <p className={loadingTextClass}>Loading work-item artifacts...</p>;
  }
  if (props.hasError) {
    return <p className={errorTextClass}>Failed to load work-item artifacts.</p>;
  }
  if (props.tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
        Artifacts appear after linked steps upload them.
      </div>
    );
  }
  if (props.artifacts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
        No artifacts recorded for this work item yet.
      </div>
    );
  }

  return (
    <section className="grid gap-3 rounded-xl border border-border/70 bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-base">Artifacts</strong>
        <Badge variant="outline">
          {describeCountLabel(props.artifacts.length, 'previewable output')}
        </Badge>
      </div>
      {props.artifacts.map((artifact) => (
        <article
          key={artifact.id}
          className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <ArtifactIdentity artifact={artifact} />
            <Badge variant="outline">{artifact.content_type}</Badge>
          </div>
          <div className={metaRowClass}>
            <Badge variant="outline">{artifact.task_title}</Badge>
            <Badge variant="outline">{artifact.size_bytes} bytes</Badge>
            <CopyableIdBadge value={artifact.id} label="Artifact" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <RelativeTimestamp value={artifact.created_at} prefix="Created" />
            <Link to={buildArtifactPermalink(artifact.task_id, artifact.id)}>Preview artifact</Link>
          </div>
        </article>
      ))}
    </section>
  );
}

function MemoryEmptyState(props: {
  title: string;
  badge: string;
  summary: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-xl border border-dashed border-border/70 bg-border/5 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-1">
          <strong className="text-sm">{props.title}</strong>
          <p className={mutedBodyClass}>{props.summary}</p>
        </div>
        <Badge variant="outline">{props.badge}</Badge>
      </div>
      <div className="rounded-lg border border-border/70 bg-surface/80 p-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
          What shows up here
        </p>
        <p className="mt-2 text-sm leading-6 text-muted">{props.detail}</p>
      </div>
    </div>
  );
}

function ArtifactIdentity(props: { artifact: DashboardWorkItemArtifactRecord }): JSX.Element {
  const identity = describeWorkItemArtifactIdentity(props.artifact.logical_path);
  return (
    <div className="grid gap-1">
      <strong className="break-all">{identity.fileName}</strong>
      {identity.displayPath ? <CopyableIdBadge value={identity.displayPath} label="Path" /> : null}
    </div>
  );
}

function formatMemoryHistoryEventType(eventType: string): string {
  if (eventType === 'deleted') {
    return 'Deleted value';
  }
  if (eventType === 'created') {
    return 'Created value';
  }
  return 'Updated value';
}

function StructuredValueReview(props: {
  label: string;
  value: unknown;
  emptyMessage: string;
  disclosureLabel: string;
}): JSX.Element {
  const summary = summarizeStructuredValue(props.value);
  if (!summary.hasValue) {
    return <p className={mutedBodyClass}>{props.emptyMessage}</p>;
  }

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-background/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {props.label}
          </div>
          <p className={mutedBodyClass}>{summary.detail}</p>
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
