import type { WorkflowDeliverableRecord } from '../workflow-deliverable-service.js';
import type { WorkflowDeliverableHandoffRecord } from '../workflow-deliverable-handoff-service.js';
import type { WorkflowInputPacketRecord } from '../workflow-input-packet-service.js';
import type { WorkflowOperatorBriefRecord } from '../workflow-operator-brief-service.js';
import type { WorkflowDeliverablesPacket } from './workflow-operations-types.js';
import {
  paginateOrderedItems,
  resolveFetchWindow,
} from './workflow-packet-cursors.js';

const CANONICAL_DELIVERABLE_PACKET_KIND = 'deliverable_packet';

interface DeliverableSource {
  listDeliverables(
    tenantId: string,
    workflowId: string,
    input?: {
      workItemId?: string;
      includeWorkflowScope?: boolean;
      includeAllWorkItemScopes?: boolean;
      limit?: number;
    },
  ): Promise<WorkflowDeliverableRecord[]>;
}

interface BriefSource {
  listBriefs(
    tenantId: string,
    workflowId: string,
    input?: {
      workItemId?: string;
      includeWorkflowScope?: boolean;
      includeAllWorkItemScopes?: boolean;
      limit?: number;
    },
  ): Promise<WorkflowOperatorBriefRecord[]>;
}

interface InputPacketSource {
  listWorkflowInputPackets(tenantId: string, workflowId: string): Promise<WorkflowInputPacketRecord[]>;
}

interface HandoffSource {
  listLatestCompletedWorkItemHandoffs(
    tenantId: string,
    workflowId: string,
    input?: { workItemId?: string },
  ): Promise<WorkflowDeliverableHandoffRecord[]>;
}

export class WorkflowDeliverablesService {
  constructor(
    private readonly deliverableSource: DeliverableSource,
    private readonly briefSource: BriefSource,
    private readonly inputPacketSource: InputPacketSource,
    private readonly handoffSource?: HandoffSource,
  ) {}

  async getDeliverables(
    tenantId: string,
    workflowId: string,
    input: { limit?: number; workItemId?: string; after?: string } = {},
  ): Promise<WorkflowDeliverablesPacket & { all_deliverables: WorkflowDeliverableRecord[] }> {
    const limit = input.limit ?? 10;
    const fetchWindow = resolveFetchWindow(limit);
    const includeWorkflowScope = Boolean(input.workItemId);
    const includeAllWorkItemScopes = false;
    const [deliverables, briefs, inputPackets, handoffs] = await Promise.all([
      this.deliverableSource.listDeliverables(tenantId, workflowId, {
        workItemId: input.workItemId,
        includeWorkflowScope,
        includeAllWorkItemScopes,
        limit: fetchWindow,
      }),
      this.briefSource.listBriefs(tenantId, workflowId, {
        workItemId: input.workItemId,
        includeWorkflowScope,
        includeAllWorkItemScopes,
        limit,
      }),
      this.inputPacketSource.listWorkflowInputPackets(tenantId, workflowId),
      this.handoffSource?.listLatestCompletedWorkItemHandoffs(tenantId, workflowId, {
        workItemId: input.workItemId,
      }) ?? Promise.resolve([]),
    ]);
    const scopedDeliverables = filterRecordsForRequestedScope(
      deliverables,
      input.workItemId,
      (deliverable) => deliverable.work_item_id,
    );
    const scopedBriefs = filterRecordsForRequestedScope(
      briefs,
      input.workItemId,
      (brief) => readOptionalString(brief.work_item_id),
    );
    const scopedHandoffs = filterRecordsForRequestedScope(
      handoffs,
      input.workItemId,
      (handoff) => handoff.work_item_id,
    );
    const finalizedBriefIds = collectFinalizedBriefIds(scopedBriefs);
    const finalizedDescriptorIds = collectFinalizedDescriptorIds(scopedBriefs);
    const hydratedDeliverables = appendSynthesizedBriefDeliverables(
      appendSynthesizedHandoffDeliverables(scopedDeliverables, scopedHandoffs),
      scopedBriefs,
    );

    const orderedDeliverables = [...hydratedDeliverables].sort((left, right) =>
      compareDeliverables(left, right),
    );
    const page = paginateOrderedItems(orderedDeliverables, limit, input.after, (deliverable) => ({
      timestamp: deliverable.updated_at ?? deliverable.created_at,
      id: deliverable.descriptor_id,
    }));
    const allDeliverables = orderedDeliverables;
    const pagedDeliverables = page.items;
    return {
      final_deliverables: pagedDeliverables.filter((deliverable) =>
        isFinalDeliverable(deliverable, finalizedBriefIds, finalizedDescriptorIds),
      ),
      in_progress_deliverables: pagedDeliverables.filter((deliverable) =>
        !isFinalDeliverable(deliverable, finalizedBriefIds, finalizedDescriptorIds),
      ),
      working_handoffs: scopedBriefs.filter(isDeliverableBrief),
      inputs_and_provenance: {
        launch_packet: pickSinglePacket(inputPackets, 'launch', input.workItemId),
        supplemental_packets: filterPacketKinds(
          inputPackets,
          ['intake', 'plan_update'],
          input.workItemId,
        ),
        intervention_attachments: filterPacketKinds(
          inputPackets,
          ['intervention_attachment'],
          input.workItemId,
        ),
        redrive_packet: pickSinglePacket(inputPackets, 'redrive_patch', input.workItemId),
      },
      next_cursor: page.nextCursor,
      all_deliverables: allDeliverables,
    };
  }
}

function filterRecordsForRequestedScope<T>(
  records: T[],
  workItemId: string | undefined,
  readWorkItemId: (record: T) => string | null,
): T[] {
  if (!workItemId) {
    return records.filter((record) => readWorkItemId(record) === null);
  }

  return records.filter((record) => {
    const recordWorkItemId = readWorkItemId(record);
    return recordWorkItemId === null || recordWorkItemId === workItemId;
  });
}

function appendSynthesizedHandoffDeliverables(
  deliverables: WorkflowDeliverableRecord[],
  handoffs: WorkflowDeliverableHandoffRecord[],
): WorkflowDeliverableRecord[] {
  if (handoffs.length === 0) {
    return deliverables;
  }
  const records = [...deliverables];
  const existingFinalWorkItemIds = new Set(
    deliverables
      .filter(isStoredFinalDeliverable)
      .map((deliverable) => readOptionalString(deliverable.work_item_id))
      .filter((workItemId): workItemId is string => workItemId !== null),
  );
  for (const handoff of handoffs) {
    if (isOrchestratorRole(handoff.role)) {
      continue;
    }
    if (existingFinalWorkItemIds.has(handoff.work_item_id)) {
      continue;
    }
    records.push(buildHandoffPacketDeliverable(handoff));
    existingFinalWorkItemIds.add(handoff.work_item_id);
  }
  return records;
}

function appendSynthesizedBriefDeliverables(
  deliverables: WorkflowDeliverableRecord[],
  briefs: WorkflowOperatorBriefRecord[],
): WorkflowDeliverableRecord[] {
  const records = [...deliverables];
  const existingBriefIds = new Set(
    deliverables
      .map((deliverable) => readOptionalString(deliverable.source_brief_id))
      .filter((briefId): briefId is string => briefId !== null),
  );
  const existingFinalPacketScopes = new Set(
    deliverables
      .filter(isPacketLikeDeliverable)
      .filter(isStoredFinalDeliverable)
      .map((deliverable) => buildDeliverableScopeKey(readOptionalString(deliverable.work_item_id))),
  );
  const existingPacketScopes = new Set(
    deliverables
      .filter(isPacketLikeDeliverable)
      .map((deliverable) => buildDeliverableScopeKey(readOptionalString(deliverable.work_item_id))),
  );

  for (const brief of briefs) {
    if (!shouldSynthesizeBriefDeliverable(brief)) {
      continue;
    }
    if (isOrchestratorBrief(brief) && readOptionalString(brief.work_item_id) !== null) {
      continue;
    }
    if (existingBriefIds.has(brief.id)) {
      continue;
    }
    const scopeKey = buildDeliverableScopeKey(readOptionalString(brief.work_item_id));
    if (existingFinalPacketScopes.has(scopeKey)) {
      continue;
    }
    if (isOrchestratorBrief(brief) && existingPacketScopes.has(scopeKey)) {
      continue;
    }
    records.push(buildBriefPacketDeliverable(brief));
    existingFinalPacketScopes.add(scopeKey);
    existingPacketScopes.add(scopeKey);
  }

  return records;
}

function buildHandoffPacketDeliverable(
  handoff: WorkflowDeliverableHandoffRecord,
): WorkflowDeliverableRecord {
  const previewText = [
    handoff.summary,
    handoff.completion.trim(),
    handoff.decision_state ? `Decision: ${humanizeToken(handoff.decision_state)}` : null,
    handoff.role ? `Produced by: ${humanizeToken(handoff.role)}` : null,
  ]
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .join('\n\n');
  const workItemTitle = handoff.work_item_title ?? 'Work item';
  return {
    descriptor_id: `handoff:${handoff.id}`,
    workflow_id: handoff.workflow_id,
    work_item_id: handoff.work_item_id,
    descriptor_kind: 'handoff_packet',
    delivery_stage: 'final',
    title: `${workItemTitle} completion packet`,
    state: 'final',
    summary_brief: handoff.summary,
    preview_capabilities: {
      can_inline_preview: true,
      can_download: false,
      can_open_external: false,
      can_copy_path: false,
      preview_kind: 'structured_summary',
    },
    primary_target: {
      target_kind: 'inline_summary',
      label: 'Review completion packet',
    },
    secondary_targets: [],
    content_preview: {
      summary: previewText,
    },
    source_brief_id: null,
    created_at: handoff.created_at,
    updated_at: handoff.created_at,
  };
}

function buildBriefPacketDeliverable(
  brief: WorkflowOperatorBriefRecord,
): WorkflowDeliverableRecord {
  const workItemId = resolveDeliverableWorkItemId(brief);
  const headline = readBriefHeadline(brief);
  const summary = readBriefSummary(brief);
  const previewText = [headline, summary, readBriefSourceLabel(brief)]
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .join('\n\n');

  return {
    descriptor_id: `brief:${brief.id}`,
    workflow_id: brief.workflow_id,
    work_item_id: workItemId,
    descriptor_kind: 'brief_packet',
    delivery_stage: 'final',
    title: headline,
    state: 'final',
    summary_brief: summary,
    preview_capabilities: {
      can_inline_preview: true,
      can_download: false,
      can_open_external: false,
      can_copy_path: false,
      preview_kind: 'structured_summary',
    },
    primary_target: {
      target_kind: 'inline_summary',
      label: 'Review completion packet',
    },
    secondary_targets: [],
    content_preview: {
      summary: previewText,
    },
    source_brief_id: brief.id,
    created_at: brief.created_at,
    updated_at: brief.updated_at,
  };
}

function isDeliverableBrief(brief: WorkflowOperatorBriefRecord): boolean {
  return readOptionalString(brief.brief_scope) === 'deliverable_context';
}

function shouldSynthesizeBriefDeliverable(brief: WorkflowOperatorBriefRecord): boolean {
  const attributedWorkItemId = resolveDeliverableWorkItemId(brief);
  return (
    isDeliverableBrief(brief)
    && isDeliverableOutcomeStatus(readOptionalString(brief.status_kind))
    && (
      !isWorkflowScopedOrchestratorBriefLinkedToChildScope(brief)
      || attributedWorkItemId !== null
    )
  );
}

function isFinalDeliverable(
  deliverable: WorkflowDeliverableRecord,
  finalizedBriefIds: Set<string>,
  finalizedDescriptorIds: Set<string>,
): boolean {
  return (
    readOptionalString(deliverable.delivery_stage) === 'final' ||
    readOptionalString(deliverable.state) === 'final' ||
    finalizedBriefIds.has(deliverable.source_brief_id ?? '') ||
    finalizedDescriptorIds.has(deliverable.descriptor_id)
  );
}

function isStoredFinalDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  return readOptionalString(deliverable.delivery_stage) === 'final'
    || readOptionalString(deliverable.state) === 'final';
}

function collectFinalizedBriefIds(briefs: WorkflowOperatorBriefRecord[]): Set<string> {
  return new Set(
    briefs
      .filter((brief) => isDeliverableOutcomeStatus(readOptionalString(brief.status_kind)))
      .map((brief) => brief.id),
  );
}

function collectFinalizedDescriptorIds(briefs: WorkflowOperatorBriefRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const brief of briefs) {
    if (!isDeliverableOutcomeStatus(readOptionalString(brief.status_kind))) {
      continue;
    }
    for (const descriptorId of brief.related_output_descriptor_ids ?? []) {
      const normalizedId = readOptionalString(descriptorId);
      if (normalizedId) {
        ids.add(normalizedId);
      }
    }
  }
  return ids;
}

function isDeliverableOutcomeStatus(statusKind: string | null): boolean {
  return statusKind === 'completed' || statusKind === 'final' || statusKind === 'approved';
}

function isOrchestratorBrief(brief: WorkflowOperatorBriefRecord): boolean {
  return isOrchestratorRole(brief.source_kind) || isOrchestratorRole(brief.source_role_name);
}

function isOrchestratorRole(value: string | null | undefined): boolean {
  return readOptionalString(value)?.toLowerCase() === 'orchestrator';
}

function isWorkflowScopedOrchestratorBriefLinkedToChildScope(brief: WorkflowOperatorBriefRecord): boolean {
  if (readOptionalString(brief.work_item_id) !== null) {
    return false;
  }
  if (!isOrchestratorBrief(brief)) {
    return false;
  }
  return (brief.linked_target_ids ?? []).some((targetId) => {
    const normalizedTargetId = readOptionalString(targetId);
    return normalizedTargetId !== null && normalizedTargetId !== brief.workflow_id;
  });
}

function resolveDeliverableWorkItemId(brief: WorkflowOperatorBriefRecord): string | null {
  const storedWorkItemId = readOptionalString(brief.work_item_id);
  if (storedWorkItemId) {
    return storedWorkItemId;
  }
  if (!isWorkflowScopedOrchestratorBriefLinkedToChildScope(brief)) {
    return null;
  }
  const candidateIds = (brief.linked_target_ids ?? [])
    .map((targetId) => readOptionalString(targetId))
    .filter((targetId): targetId is string => targetId !== null && targetId !== brief.workflow_id);
  return candidateIds.length === 1 ? candidateIds[0] : null;
}

function pickSinglePacket(
  packets: WorkflowInputPacketRecord[],
  packetKind: string,
  workItemId?: string,
) : WorkflowInputPacketRecord | null {
  return packets.find((packet) =>
    readOptionalString(packet.packet_kind) === packetKind
    && packetMatchesScope(packet, workItemId),
  ) ?? null;
}

function filterPacketKinds(
  packets: WorkflowInputPacketRecord[],
  packetKinds: string[],
  workItemId?: string,
): WorkflowInputPacketRecord[] {
  return packets.filter((packet) => {
    if (!packetKinds.includes(readOptionalString(packet.packet_kind) ?? '')) {
      return false;
    }
    return packetMatchesScope(packet, workItemId);
  });
}

function packetMatchesScope(
  packet: WorkflowInputPacketRecord,
  workItemId?: string,
): boolean {
  const packetWorkItemId = readOptionalString(packet.work_item_id);
  if (workItemId) {
    return packetWorkItemId === workItemId;
  }
  return packetWorkItemId === null;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPacketLikeDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  const descriptorKind = readOptionalString(deliverable.descriptor_kind);
  return descriptorKind === 'handoff_packet'
    || descriptorKind === 'brief_packet'
    || descriptorKind === CANONICAL_DELIVERABLE_PACKET_KIND;
}

function buildDeliverableScopeKey(workItemId: string | null): string {
  return workItemId ?? '__workflow__';
}

function readBriefHeadline(brief: WorkflowOperatorBriefRecord): string {
  return (
    readOptionalString(asRecord(brief.detailed_brief_json).headline)
    ?? readOptionalString(asRecord(brief.short_brief).headline)
    ?? 'Workflow deliverable packet'
  );
}

function readBriefSummary(brief: WorkflowOperatorBriefRecord): string | null {
  return (
    readOptionalString(asRecord(brief.detailed_brief_json).summary)
    ?? readOptionalString(asRecord(brief.short_brief).headline)
  );
}

function readBriefSourceLabel(brief: WorkflowOperatorBriefRecord): string | null {
  const roleName = readOptionalString(brief.source_role_name);
  return roleName ? `Produced by: ${roleName}` : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function compareDeliverables(
  left: WorkflowDeliverableRecord,
  right: WorkflowDeliverableRecord,
): number {
  const leftTimestamp = left.updated_at ?? left.created_at;
  const rightTimestamp = right.updated_at ?? right.created_at;
  return rightTimestamp.localeCompare(leftTimestamp) || right.descriptor_id.localeCompare(left.descriptor_id);
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
