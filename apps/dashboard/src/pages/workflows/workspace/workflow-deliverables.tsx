import { Badge } from '../../../components/ui/badge.js';
import type {
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowDeliverablesPacket,
  DashboardWorkflowDeliverableTarget,
  DashboardWorkflowOperatorBriefRecord,
} from '../../../lib/api.js';
import { WorkflowBriefRenderer } from './workflow-brief-renderer.js';

export function WorkflowDeliverables(props: {
  packet: DashboardWorkflowDeliverablesPacket;
  onLoadMore(): void;
}): JSX.Element {
  const outcomeBrief = pickOutcomeBrief(
    props.packet.final_deliverables,
    props.packet.working_handoffs,
  );
  const openInProgressByDefault = props.packet.final_deliverables.length === 0;

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-sm font-semibold text-foreground">Deliverables</p>
        <p className="text-sm text-muted-foreground">
          Final outputs stay prominent while in-progress deliverables, handoffs, and input provenance remain available in place.
        </p>
      </div>

      {outcomeBrief ? (
        <section className="grid gap-4 rounded-2xl border border-emerald-300/60 bg-emerald-50/60 p-4 dark:border-emerald-800/60 dark:bg-emerald-950/20">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">Outcome Brief</Badge>
            <Badge variant="outline">{humanizeToken(outcomeBrief.status_kind)}</Badge>
          </div>
          <WorkflowBriefRenderer brief={outcomeBrief} />
        </section>
      ) : null}

      <details className="rounded-2xl border border-border/70 bg-background/80 p-4" open>
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Final Deliverables ({props.packet.final_deliverables.length})
        </summary>
        <div className="mt-4 grid gap-4">
          {props.packet.final_deliverables.length === 0 ? (
            <p className="text-sm text-muted-foreground">No final deliverables are available yet.</p>
          ) : (
            props.packet.final_deliverables.map((deliverable) => (
              <DeliverableCard key={deliverable.descriptor_id} deliverable={deliverable} prominent />
            ))
          )}
        </div>
      </details>

      <details className="rounded-2xl border border-border/70 bg-background/80 p-4" open={openInProgressByDefault}>
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          In Progress Deliverables ({props.packet.in_progress_deliverables.length})
        </summary>
        <div className="mt-4 grid gap-4">
          {props.packet.in_progress_deliverables.length === 0 ? (
            <p className="text-sm text-muted-foreground">No in-progress deliverables are attached to this workflow.</p>
          ) : (
            props.packet.in_progress_deliverables.map((deliverable) => (
              <DeliverableCard key={deliverable.descriptor_id} deliverable={deliverable} />
            ))
          )}
        </div>
      </details>

      <details className="rounded-2xl border border-border/70 bg-background/80 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Working Handoffs ({props.packet.working_handoffs.length})
        </summary>
        <div className="mt-4 grid gap-4">
          {props.packet.working_handoffs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No milestone handoffs have been published yet.</p>
          ) : (
            props.packet.working_handoffs.map((brief) => (
              <article key={brief.id} className="rounded-2xl border border-border/70 bg-muted/10 p-4">
                <WorkflowBriefRenderer brief={brief} compact />
              </article>
            ))
          )}
        </div>
      </details>

      <details className="rounded-2xl border border-border/70 bg-background/80 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Inputs & Provenance
        </summary>
        <div className="mt-4 grid gap-3">
          <ProvenanceLine
            label="Launch packet"
            value={props.packet.inputs_and_provenance.launch_packet?.summary ?? 'Not available'}
          />
          <ProvenanceLine
            label="Supplemental packets"
            value={String(props.packet.inputs_and_provenance.supplemental_packets.length)}
          />
          <ProvenanceLine
            label="Intervention attachments"
            value={String(props.packet.inputs_and_provenance.intervention_attachments.length)}
          />
          <ProvenanceLine
            label="Redrive packet"
            value={props.packet.inputs_and_provenance.redrive_packet?.summary ?? 'Not available'}
          />
        </div>
      </details>

      <div className="flex justify-end">
        <button
          type="button"
          className="text-sm font-medium text-accent underline-offset-4 hover:underline"
          onClick={props.onLoadMore}
        >
          Load older deliverables
        </button>
      </div>
    </div>
  );
}

function DeliverableCard(props: {
  deliverable: DashboardWorkflowDeliverableRecord;
  prominent?: boolean;
}): JSX.Element {
  const previewText = readPreviewText(props.deliverable);

  return (
    <article
      className={
        props.prominent
          ? 'grid gap-4 rounded-2xl border border-emerald-300/60 bg-emerald-50/60 p-4 dark:border-emerald-800/60 dark:bg-emerald-950/20'
          : 'grid gap-4 rounded-2xl border border-border/70 bg-muted/10 p-4'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-foreground">{props.deliverable.title}</strong>
        <Badge variant="outline">{humanizeToken(props.deliverable.state)}</Badge>
        <Badge variant="secondary">{humanizeToken(props.deliverable.delivery_stage)}</Badge>
      </div>
      {props.deliverable.summary_brief ? (
        <p className="text-sm text-muted-foreground">{props.deliverable.summary_brief}</p>
      ) : null}
      {previewText ? (
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-background/80 p-3 text-xs text-foreground">
          {previewText}
        </pre>
      ) : null}
      <div className="grid gap-2">
        <DeliverableTargetLink target={props.deliverable.primary_target} primary />
        {props.deliverable.secondary_targets.map((target, index) => (
          <DeliverableTargetLink
            key={`${props.deliverable.descriptor_id}:secondary:${index}`}
            target={target}
          />
        ))}
      </div>
    </article>
  );
}

function DeliverableTargetLink(props: {
  target: DashboardWorkflowDeliverableTarget;
  primary?: boolean;
}): JSX.Element {
  return (
    <div className="grid gap-1">
      <a
        className="text-sm font-medium text-accent underline-offset-4 hover:underline"
        href={props.target.url}
        target="_blank"
        rel="noreferrer"
      >
        {props.primary ? props.target.label : `${props.target.label} (${humanizeToken(props.target.target_kind)})`}
      </a>
      {props.target.path || props.target.repo_ref ? (
        <p className="text-xs text-muted-foreground">{props.target.path ?? props.target.repo_ref}</p>
      ) : null}
    </div>
  );
}

function ProvenanceLine(props: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="grid gap-1 rounded-xl border border-border/70 bg-muted/10 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {props.label}
      </p>
      <p className="text-sm text-foreground">{props.value}</p>
    </div>
  );
}

function pickOutcomeBrief(
  finalDeliverables: DashboardWorkflowDeliverableRecord[],
  handoffs: DashboardWorkflowOperatorBriefRecord[],
): DashboardWorkflowOperatorBriefRecord | null {
  const briefById = new Map(handoffs.map((brief) => [brief.id, brief]));
  for (const deliverable of finalDeliverables) {
    if (deliverable.source_brief_id && briefById.has(deliverable.source_brief_id)) {
      return briefById.get(deliverable.source_brief_id) ?? null;
    }
  }
  return handoffs.find((brief) => brief.work_item_id === null) ?? null;
}

function readPreviewText(deliverable: DashboardWorkflowDeliverableRecord): string | null {
  const preview = asRecord(deliverable.content_preview);
  return (
    readText(preview.markdown) ??
    readText(preview.text) ??
    readText(preview.summary) ??
    readText(preview.snippet)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function humanizeToken(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
