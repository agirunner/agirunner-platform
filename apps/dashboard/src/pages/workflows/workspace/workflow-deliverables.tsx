import { Badge } from '../../../components/ui/badge.js';
import type {
  DashboardTaskRecord,
  DashboardWorkflowDeliverableTarget,
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowDeliverablesPacket,
  DashboardWorkflowInputPacketFileRecord,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowInterventionRecord,
  DashboardWorkflowOperatorBriefRecord,
} from '../../../lib/api.js';
import type { WorkflowWorkbenchScopeDescriptor } from '../workflows-page.support.js';
import { WorkflowDeliverableBrowser } from './workflow-deliverable-browser.js';
import { WorkflowBriefRenderer } from './workflow-brief-renderer.js';
import {
  hasMeaningfulDeliverableTarget,
  normalizeDeliverablesPacket,
  sanitizeDeliverableTarget,
  sanitizeDeliverableTargets,
} from './workflow-deliverables.support.js';

export function WorkflowDeliverables(props: {
  packet: DashboardWorkflowDeliverablesPacket;
  selectedTask: DashboardTaskRecord | null;
  selectedWorkItemId: string | null;
  selectedWorkItemTitle: string | null;
  scope: WorkflowWorkbenchScopeDescriptor;
  onLoadMore(): void;
}): JSX.Element {
  const packet = normalizeDeliverablesPacket(props.packet);
  const selectedWorkItemId = props.selectedWorkItemId ?? props.selectedTask?.work_item_id ?? null;
  const scopeCopy = buildDeliverablesScopeCopy(props.scope, props.selectedWorkItemTitle);
  const displayPacket = buildDisplayPacketForScope(packet, props.scope.scopeKind);
  const taskEvidence = props.scope.scopeKind === 'selected_task'
    ? buildTaskEvidence(props.selectedTask)
    : null;
  const deliverablesSubject = readDeliverablesSubject(props.scope.scopeKind);
  const parentWorkItemLayer = buildDeliverableLayer(
    displayPacket,
    selectedWorkItemId,
    'work_item',
  );
  const workflowLayer = buildDeliverableLayer(
    displayPacket,
    selectedWorkItemId,
    'workflow',
  );
  const rolledUpWorkItemLayer = buildDeliverableLayer(
    displayPacket,
    null,
    'work_item',
  );
  const outcomeBrief = pickOutcomeBrief(
    workflowLayer.finalDeliverables,
    workflowLayer.workingHandoffs,
  );
  const briefBackedOutputs =
    displayPacket.final_deliverables.length === 0
    && displayPacket.in_progress_deliverables.length === 0
    && displayPacket.working_handoffs.length > 0;
  const openBriefsByDefault =
    !briefBackedOutputs
    && displayPacket.final_deliverables.length === 0
    && displayPacket.in_progress_deliverables.length === 0
    && displayPacket.working_handoffs.length > 0;
  const inputEntries = buildInputEntries(displayPacket);

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">Deliverables</p>
          <Badge variant="outline">{scopeCopy.label}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {scopeCopy.description}
        </p>
      </div>

      {props.scope.scopeKind === 'workflow' && outcomeBrief ? (
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
          <div className="grid gap-2">
            <p className="text-sm font-semibold text-foreground">Task output and evidence</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{props.selectedTask?.title ?? 'Selected task'}</Badge>
            </div>
          </div>
          <StructuredValuePreview value={taskEvidence} />
        </section>
      ) : null}

      {props.scope.scopeKind === 'workflow' ? (
        <>
          <LayerDeliverablesSection
            title="Workflow deliverables"
            titleCount={workflowLayer.totalCount}
            emptyMessage="No workflow deliverables are available yet."
            layer={workflowLayer}
          />
          <LayerDeliverablesSection
            title="Work item deliverables"
            titleCount={rolledUpWorkItemLayer.totalCount}
            description="Rolled up from work items so workflow scope stays aligned with operator-visible delivery."
            emptyMessage="No work item deliverables are available yet."
            layer={rolledUpWorkItemLayer}
          />
        </>
      ) : (
        <>
          <LayerDeliverablesSection
            title={props.scope.scopeKind === 'selected_task' ? 'Parent work item deliverables' : 'Work item deliverables'}
            titleCount={parentWorkItemLayer.totalCount}
            description={
              props.scope.scopeKind === 'selected_task'
                ? props.selectedWorkItemTitle
                  ? `Deliverables promoted from ${props.selectedWorkItemTitle} stay here.`
                  : 'Deliverables promoted from the parent work item stay here.'
                : null
            }
            emptyMessage={
              props.selectedWorkItemTitle
                ? `No work item deliverables are available for ${props.selectedWorkItemTitle} yet.`
                : 'No work item deliverables are available yet.'
            }
            layer={parentWorkItemLayer}
          />
          <LayerDeliverablesSection
            title="Workflow deliverables"
            titleCount={workflowLayer.totalCount}
            description={
              props.scope.scopeKind === 'selected_task'
                ? 'Workflow-wide deliverables stay visible below the parent work item.'
                : null
            }
            emptyMessage="No workflow deliverables are available yet."
            layer={workflowLayer}
          />
        </>
      )}
      {props.scope.scopeKind !== 'workflow' && !briefBackedOutputs ? (
        <details
          className="rounded-2xl border border-border/70 bg-background/80 p-4"
          open={openBriefsByDefault}
        >
          <summary className="cursor-pointer text-sm font-semibold text-foreground">
            Briefs ({displayPacket.working_handoffs.length})
          </summary>
          <div className="mt-4 grid gap-4">
            {displayPacket.working_handoffs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No milestone briefs have been published yet.</p>
            ) : (
              displayPacket.working_handoffs.map((brief) => (
                <article key={brief.id} className="grid gap-3 rounded-2xl border border-border/70 bg-muted/10 p-4">
                  <WorkflowBriefRenderer brief={brief} compact />
                </article>
              ))
            )}
          </div>
        </details>
      ) : null}

      <details className="rounded-2xl border border-border/70 bg-background/80 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Inputs
        </summary>
        <div className="mt-4 grid gap-4">
          {inputEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No inputs or intervention files are attached to this {deliverablesSubject}.
            </p>
          ) : (
            inputEntries.map((entry) => (
              <InputEntryCard key={entry.id} entry={entry} />
            ))
          )}
        </div>
      </details>

      <div className="flex justify-start sm:justify-end">
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

function buildDisplayPacketForScope(
  packet: DashboardWorkflowDeliverablesPacket,
  scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind'],
): DashboardWorkflowDeliverablesPacket {
  if (scopeKind === 'workflow') {
    return packet;
  }

  const deliverables = [
    ...packet.final_deliverables,
    ...packet.in_progress_deliverables,
  ];
  return {
    ...packet,
    final_deliverables: deliverables.filter(isExplicitlyFinalDeliverable),
    in_progress_deliverables: deliverables.filter((deliverable) => !isExplicitlyFinalDeliverable(deliverable)),
  };
}

function isExplicitlyFinalDeliverable(
  deliverable: DashboardWorkflowDeliverableRecord,
): boolean {
  return readText(deliverable.delivery_stage) === 'final'
    || readText(deliverable.state) === 'final';
}

function buildDeliverablesScopeCopy(
  scope: WorkflowWorkbenchScopeDescriptor,
  selectedWorkItemTitle: string | null,
): {
  label: string;
  description: string;
} {
  const workItemTitle = readText(selectedWorkItemTitle);
  if (scope.scopeKind === 'selected_task') {
    return {
      label: 'Task evidence + parent deliverables',
      description: [
        'Task output and evidence appears first.',
        workItemTitle
          ? `Showing parent work item deliverables from ${workItemTitle}.`
          : 'Showing parent work item deliverables from the parent work item.',
        'Workflow deliverables stay visible below the parent work item.',
      ].join(' '),
    };
  }
  if (scope.scopeKind === 'selected_work_item') {
    return {
      label: 'Work item + workflow deliverables',
      description: workItemTitle
        ? `Showing work item deliverables for ${workItemTitle}, followed by workflow deliverables.`
        : 'Showing work item deliverables first, followed by workflow deliverables.',
    };
  }
  return {
    label: 'Workflow deliverables',
    description:
      'Workflow deliverables stay prominent while active deliverables, briefs, and inputs remain available in place.',
  };
}

type DeliverableLayerKind = 'workflow' | 'work_item';

function buildDeliverableLayer(
  packet: DashboardWorkflowDeliverablesPacket,
  selectedWorkItemId: string | null,
  layer: DeliverableLayerKind,
): {
  finalDeliverables: DashboardWorkflowDeliverableRecord[];
  inProgressDeliverables: DashboardWorkflowDeliverableRecord[];
  workingHandoffs: DashboardWorkflowOperatorBriefRecord[];
  totalCount: number;
} {
  const matchesLayer = (workItemId: string | null): boolean => {
    if (layer === 'workflow') {
      return workItemId === null;
    }
    if (selectedWorkItemId) {
      return workItemId === selectedWorkItemId;
    }
    return workItemId !== null;
  };

  const finalDeliverables = packet.final_deliverables.filter((deliverable) =>
    matchesLayer(deliverable.work_item_id),
  );
  const inProgressDeliverables = packet.in_progress_deliverables.filter((deliverable) =>
    matchesLayer(deliverable.work_item_id),
  );
  const workingHandoffs = packet.working_handoffs.filter((brief) =>
    matchesLayer(brief.work_item_id),
  );

  return {
    finalDeliverables,
    inProgressDeliverables,
    workingHandoffs,
    totalCount: finalDeliverables.length + inProgressDeliverables.length,
  };
}

function readDeliverablesSubject(
  scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind'],
): 'workflow' | 'work item' {
  return scopeKind === 'workflow' ? 'workflow' : 'work item';
}

function LayerDeliverablesSection(props: {
  title: string;
  titleCount: number;
  description?: string | null;
  emptyMessage: string;
  layer: {
    finalDeliverables: DashboardWorkflowDeliverableRecord[];
    inProgressDeliverables: DashboardWorkflowDeliverableRecord[];
    workingHandoffs: DashboardWorkflowOperatorBriefRecord[];
    totalCount: number;
  };
}): JSX.Element {
  const hasMaterialDeliverables =
    props.layer.finalDeliverables.length > 0 || props.layer.inProgressDeliverables.length > 0;

  return (
    <details className="rounded-2xl border border-border/70 bg-background/80 p-4" open>
      <summary className="cursor-pointer text-sm font-semibold text-foreground">
        {props.title} ({props.titleCount})
      </summary>
      <div className="mt-4 grid gap-4">
        {props.description ? (
          <p className="text-sm text-muted-foreground">{props.description}</p>
        ) : null}
        {hasMaterialDeliverables ? (
          <>
            {props.layer.finalDeliverables.map((deliverable) => (
              <DeliverableCard key={deliverable.descriptor_id} deliverable={deliverable} prominent />
            ))}
            {props.layer.inProgressDeliverables.map((deliverable) => (
              <DeliverableCard key={deliverable.descriptor_id} deliverable={deliverable} />
            ))}
          </>
        ) : props.layer.workingHandoffs.length > 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              Material output is currently available only as briefs for this layer.
            </p>
            {props.layer.workingHandoffs.map((brief) => (
              <article key={brief.id} className="grid gap-3 rounded-2xl border border-border/70 bg-muted/10 p-4">
                <Badge variant="outline">Brief-backed output</Badge>
                <WorkflowBriefRenderer brief={brief} compact />
              </article>
            ))}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{props.emptyMessage}</p>
        )}
      </div>
    </details>
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
      <WorkflowDeliverableBrowser deliverable={props.deliverable} />
    </article>
  );
}

type DeliverableInputEntry =
  | {
    entry_kind: 'packet';
    id: string;
    label: string;
    packet: DashboardWorkflowInputPacketRecord;
  }
  | {
    entry_kind: 'intervention';
    id: string;
    label: string;
    intervention: DashboardWorkflowInterventionRecord;
  };

function InputEntryCard(props: {
  entry: DeliverableInputEntry;
}): JSX.Element {
  if (props.entry.entry_kind === 'intervention') {
    const intervention = props.entry.intervention;
    return (
      <article className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-sm text-foreground">{intervention.summary}</strong>
          <Badge variant="outline">{props.entry.label}</Badge>
          <Badge variant="secondary">{humanizeToken(intervention.kind)}</Badge>
        </div>
        {intervention.note ? (
          <p className="text-sm text-muted-foreground">{intervention.note}</p>
        ) : null}
        {intervention.files.length > 0 ? (
          <div className="grid gap-2">
            {intervention.files.map((file) => (
              <PacketFileLink key={file.id} file={file} />
            ))}
          </div>
        ) : null}
      </article>
    );
  }

  const packet = props.entry.packet;
  const structuredInputs = readStructuredEntries(packet.structured_inputs);
  const structuredPreview = structuredInputs.length === 0
    ? readStructuredPreview(packet.structured_inputs)
    : null;

  return (
    <article className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm text-foreground">
          {packet.summary ?? humanizeToken(packet.packet_kind)}
        </strong>
        <Badge variant="outline">{props.entry.label}</Badge>
        <Badge variant="secondary">{humanizeToken(packet.packet_kind)}</Badge>
      </div>
      <div className="grid gap-1 text-xs text-muted-foreground">
        <span>Created {formatEntryTimestamp(packet.created_at)}</span>
        <span>{packet.files.length} file(s)</span>
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
      {packet.files.length > 0 ? (
        <div className="grid gap-2">
          {packet.files.map((file) => (
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

function PacketFileLink(props: {
  file: DashboardWorkflowInputPacketFileRecord;
}): JSX.Element {
  return (
    <div className="grid gap-1">
      <a
        className="text-sm font-medium text-accent underline-offset-4 hover:underline"
        href={props.file.download_url}
        download
      >
        {props.file.file_name}
      </a>
      <p className="text-xs text-muted-foreground">
        {props.file.content_type} • {formatBytes(props.file.size_bytes)}
      </p>
    </div>
  );
}

function formatEntryTimestamp(value: string): string {
  const millis = new Date(value).getTime();
  if (!Number.isFinite(millis)) {
    return 'Unknown time';
  }
  return new Date(millis).toLocaleString();
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

function buildInputEntries(
  packet: DashboardWorkflowDeliverablesPacket,
): DeliverableInputEntry[] {
  const entries: DeliverableInputEntry[] = [];
  if (packet.inputs_and_provenance.launch_packet) {
    entries.push({
      entry_kind: 'packet',
      id: `launch:${packet.inputs_and_provenance.launch_packet.id}`,
      label: 'Launch input',
      packet: packet.inputs_and_provenance.launch_packet,
    });
  }
  for (const supplementalPacket of packet.inputs_and_provenance.supplemental_packets) {
    entries.push({
      entry_kind: 'packet',
      id: `supplemental:${supplementalPacket.id}`,
      label: 'Additional input',
      packet: supplementalPacket,
    });
  }
  for (const intervention of packet.inputs_and_provenance.intervention_attachments) {
    entries.push({
      entry_kind: 'intervention',
      id: `intervention:${intervention.id}`,
      label: 'Intervention attachment',
      intervention,
    });
  }
  if (packet.inputs_and_provenance.redrive_packet) {
    entries.push({
      entry_kind: 'packet',
      id: `redrive:${packet.inputs_and_provenance.redrive_packet.id}`,
      label: 'Redrive input',
      packet: packet.inputs_and_provenance.redrive_packet,
    });
  }
  return entries;
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
