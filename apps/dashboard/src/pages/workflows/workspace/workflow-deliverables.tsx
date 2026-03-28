import { Badge } from '../../../components/ui/badge.js';
import type {
  DashboardTaskRecord,
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowDeliverablesPacket,
  DashboardWorkflowInputPacketFileRecord,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowInterventionRecord,
  DashboardWorkflowOperatorBriefRecord,
} from '../../../lib/api.js';
import { WorkflowDeliverableTargetLink } from './workflow-deliverable-target-link.js';
import { WorkflowBriefRenderer } from './workflow-brief-renderer.js';

export function WorkflowDeliverables(props: {
  packet: DashboardWorkflowDeliverablesPacket;
  selectedTask: DashboardTaskRecord | null;
  selectedWorkItemTitle: string | null;
  onLoadMore(): void;
}): JSX.Element {
  const outcomeBrief = pickOutcomeBrief(
    props.packet.final_deliverables,
    props.packet.working_handoffs,
  );
  const openInProgressByDefault = props.packet.final_deliverables.length === 0;
  const openBriefsByDefault =
    props.packet.final_deliverables.length === 0
    && props.packet.in_progress_deliverables.length === 0
    && props.packet.working_handoffs.length > 0;
  const taskEvidence = buildTaskEvidence(props.selectedTask);
  const parentDeliverablesLabel = props.selectedTask && props.selectedWorkItemTitle
    ? `Deliverables for ${props.selectedWorkItemTitle}`
    : 'Workflow deliverables';

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-sm font-semibold text-foreground">Deliverables</p>
        <p className="text-sm text-muted-foreground">
          Final outputs stay prominent while in-progress deliverables, briefs, and inputs remain available in place.
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

      {taskEvidence ? (
        <section className="grid gap-3 rounded-2xl border border-border/70 bg-background/80 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Task Output / Evidence</Badge>
            <Badge variant="secondary">{props.selectedTask?.title ?? 'Selected task'}</Badge>
          </div>
          {props.selectedWorkItemTitle ? (
            <p className="text-sm text-muted-foreground">
              Parent work item: {props.selectedWorkItemTitle}
            </p>
          ) : null}
          <StructuredValuePreview value={taskEvidence} />
        </section>
      ) : null}

      {props.selectedTask && props.selectedWorkItemTitle ? (
        <p className="text-sm text-muted-foreground">{parentDeliverablesLabel}</p>
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

      <details
        className="rounded-2xl border border-border/70 bg-background/80 p-4"
        open={openBriefsByDefault}
      >
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Briefs ({props.packet.working_handoffs.length})
        </summary>
        <div className="mt-4 grid gap-4">
          {props.packet.working_handoffs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No milestone briefs have been published yet.</p>
          ) : (
            props.packet.working_handoffs.map((brief) => (
              <article key={brief.id} className="grid gap-3 rounded-2xl border border-border/70 bg-muted/10 p-4">
                {(props.packet.final_deliverables.length === 0 && props.packet.in_progress_deliverables.length === 0) ? (
                  <Badge variant="outline">Brief-backed output</Badge>
                ) : null}
                <WorkflowBriefRenderer brief={brief} compact />
              </article>
            ))
          )}
        </div>
      </details>

      <details className="rounded-2xl border border-border/70 bg-background/80 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Inputs
        </summary>
        <div className="mt-4 grid gap-4">
          <InputPacketSection
            label="Launch Packet"
            packets={
              props.packet.inputs_and_provenance.launch_packet
                ? [props.packet.inputs_and_provenance.launch_packet]
                : []
            }
            emptyMessage="No launch packet is available for this workflow."
          />
          <InputPacketSection
            label="Intake & Plan Updates"
            packets={props.packet.inputs_and_provenance.supplemental_packets}
            emptyMessage="No supplemental intake or plan-update packets are attached."
          />
          <InterventionAttachmentSection
            interventions={props.packet.inputs_and_provenance.intervention_attachments}
          />
          <InputPacketSection
            label="Redrive Packet"
            packets={
              props.packet.inputs_and_provenance.redrive_packet
                ? [props.packet.inputs_and_provenance.redrive_packet]
                : []
            }
            emptyMessage="No redrive packet is attached to this workflow."
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
        <WorkflowDeliverableTargetLink
          target={props.deliverable.primary_target}
          primary
        />
        {props.deliverable.secondary_targets.map((target, index) => (
          <WorkflowDeliverableTargetLink
            key={`${props.deliverable.descriptor_id}:secondary:${index}`}
            target={target}
          />
        ))}
      </div>
    </article>
  );
}

function InputPacketSection(props: {
  label: string;
  packets: DashboardWorkflowInputPacketRecord[];
  emptyMessage: string;
}): JSX.Element {
  return (
    <section className="grid gap-3">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {props.label} ({props.packets.length})
      </div>
      <div className="grid gap-3">
        {props.packets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{props.emptyMessage}</p>
        ) : (
          props.packets.map((packet) => <InputPacketCard key={packet.id} packet={packet} />)
        )}
      </div>
    </section>
  );
}

function InputPacketCard(props: {
  packet: DashboardWorkflowInputPacketRecord;
}): JSX.Element {
  const structuredInputs = readStructuredEntries(props.packet.structured_inputs);
  const structuredPreview = structuredInputs.length === 0
    ? readStructuredPreview(props.packet.structured_inputs)
    : null;

  return (
    <article className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm text-foreground">
          {props.packet.summary ?? humanizeToken(props.packet.packet_kind)}
        </strong>
        <Badge variant="outline">{humanizeToken(props.packet.packet_kind)}</Badge>
      </div>
      <div className="grid gap-1 text-xs text-muted-foreground">
        <span>Created {new Date(props.packet.created_at).toLocaleString()}</span>
        <span>{props.packet.files.length} file(s)</span>
      </div>
      {structuredInputs.length > 0 ? (
        <dl className="divide-y divide-border/60 rounded-xl border border-border/70 bg-background">
          {structuredInputs.map(([label, value]) => (
            <div key={label} className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start sm:gap-3">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {label}
              </dt>
              <dd className="text-xs text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      ) : structuredPreview ? (
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-background p-3 text-xs text-foreground">
          {structuredPreview}
        </pre>
      ) : null}
      {props.packet.files.length > 0 ? (
        <div className="grid gap-2">
          {props.packet.files.map((file) => (
            <PacketFileLink key={file.id} file={file} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function StructuredValuePreview(props: {
  value: unknown;
}): JSX.Element | null {
  const structuredEntries = readStructuredEntries(props.value);
  const structuredPreview = structuredEntries.length === 0
    ? readStructuredPreview(props.value)
    : null;
  if (structuredEntries.length === 0 && !structuredPreview) {
    return null;
  }

  if (structuredEntries.length > 0) {
    return (
      <dl className="divide-y divide-border/60 rounded-xl border border-border/70 bg-background/80">
        {structuredEntries.map(([label, value]) => (
          <div
            key={label}
            className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start sm:gap-3"
          >
            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {label}
            </dt>
            <dd className="text-sm text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <pre className="overflow-x-auto rounded-xl border border-border/70 bg-background/80 p-3 text-xs text-foreground">
      {structuredPreview}
    </pre>
  );
}

function InterventionAttachmentSection(props: {
  interventions: DashboardWorkflowInterventionRecord[];
}): JSX.Element {
  return (
    <section className="grid gap-3">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Intervention Attachments ({props.interventions.length})
      </div>
      <div className="grid gap-3">
        {props.interventions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No intervention attachments are attached to this workflow.
          </p>
        ) : (
          props.interventions.map((intervention) => (
            <article
              key={intervention.id}
              className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm text-foreground">{intervention.summary}</strong>
                <Badge variant="secondary">{humanizeToken(intervention.kind)}</Badge>
              </div>
              {intervention.note ? (
                <p className="text-sm text-muted-foreground">{intervention.note}</p>
              ) : null}
              <div className="grid gap-2">
                {intervention.files.map((file) => (
                  <PacketFileLink key={file.id} file={file} />
                ))}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function PacketFileLink(props: {
  file: DashboardWorkflowInputPacketFileRecord;
}): JSX.Element {
  return (
    <div className="grid gap-1">
      <a
        className="text-sm font-medium text-accent underline-offset-4 hover:underline"
        href={props.file.download_url}
        target="_blank"
        rel="noreferrer"
      >
        {props.file.file_name}
      </a>
      <p className="text-xs text-muted-foreground">
        {props.file.content_type} • {formatBytes(props.file.size_bytes)}
      </p>
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

function buildTaskEvidence(task: DashboardTaskRecord | null): unknown {
  if (!task) {
    return null;
  }
  const output = task.output;
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    return output;
  }
  return readText(output);
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
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function readStructuredPreview(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const rendered = JSON.stringify(value, null, 2);
  return rendered === '{}' ? null : rendered;
}

function readStructuredEntries(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const rendered: Array<[string, string]> = [];
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    const text = renderStructuredValue(entryValue);
    if (!text) {
      continue;
    }
    rendered.push([humanizeToken(key), text]);
  }
  return rendered;
}

function renderStructuredValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const rendered = value
      .map((entry) => renderStructuredValue(entry))
      .filter((entry): entry is string => Boolean(entry));
    return rendered.length > 0 ? rendered.join(' • ') : null;
  }
  return null;
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 102.4) / 10} KB`;
  }
  return `${Math.round(value / 104857.6) / 10} MB`;
}
