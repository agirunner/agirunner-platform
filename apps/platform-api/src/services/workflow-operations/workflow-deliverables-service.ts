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
const ROLLUP_SOURCE_DESCRIPTOR_ID_KEY = 'rollup_source_descriptor_id';
const ROLLUP_SOURCE_WORK_ITEM_ID_KEY = 'rollup_source_work_item_id';
const SYNTHETIC_DERIVED_DELIVERABLE_PREFIXES = ['brief:', 'handoff:'] as const;

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

interface IncompleteWorkItemSource {
  listIncompleteWorkItemIds(
    tenantId: string,
    workflowId: string,
    input?: { workItemId?: string },
  ): Promise<string[]>;

  listExistingWorkItemIds?(
    tenantId: string,
    workflowId: string,
    input?: { candidateIds?: string[] },
  ): Promise<string[]>;
}

export class WorkflowDeliverablesService {
  constructor(
    private readonly deliverableSource: DeliverableSource,
    private readonly briefSource: BriefSource,
    private readonly inputPacketSource: InputPacketSource,
    private readonly handoffSource?: HandoffSource,
    private readonly incompleteWorkItemSource?: IncompleteWorkItemSource,
  ) {}

  async getDeliverables(
    tenantId: string,
    workflowId: string,
    input: { limit?: number; workItemId?: string; after?: string } = {},
  ): Promise<WorkflowDeliverablesPacket & { all_deliverables: WorkflowDeliverableRecord[] }> {
    const limit = input.limit ?? 10;
    const fetchWindow = resolveFetchWindow(limit);
    const allowIncompleteReclassification = true;
    const includeWorkflowScope = Boolean(input.workItemId);
    const includeAllWorkItemScopes = !input.workItemId;
    const [deliverables, briefs, inputPackets, handoffs, incompleteWorkItemIds] = await Promise.all([
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
        limit: fetchWindow,
      }),
      this.inputPacketSource.listWorkflowInputPackets(tenantId, workflowId),
      this.handoffSource?.listLatestCompletedWorkItemHandoffs(tenantId, workflowId, {
        workItemId: input.workItemId,
      }) ?? Promise.resolve([]),
      this.incompleteWorkItemSource?.listIncompleteWorkItemIds(tenantId, workflowId, {
        workItemId: input.workItemId,
      }) ?? Promise.resolve([]),
    ]);
    const linkedWorkItemIds = await this.incompleteWorkItemSource?.listExistingWorkItemIds?.(
      tenantId,
      workflowId,
      {
        candidateIds: collectLinkedTargetCandidateIds(briefs),
      },
    ) ?? [];
    const incompleteWorkItemIdSet = new Set(incompleteWorkItemIds);
    const linkedWorkItemIdSet = new Set(linkedWorkItemIds);
    const deliverableWorkItemAttribution = buildDeliverableWorkItemAttribution(
      briefs,
      linkedWorkItemIdSet,
    );
    const deliverableScopeBriefs = selectDeliverableScopeRecords(
      briefs,
      input.workItemId,
      (brief) => resolveDeliverableWorkItemId(brief, linkedWorkItemIdSet),
      (brief) => shouldRollUpChildScopeBrief(brief, linkedWorkItemIdSet),
    );
    const scopedHandoffs = selectDeliverableScopeRecords(
      handoffs,
      input.workItemId,
      (handoff) => handoff.work_item_id,
      () => true,
    );
    const finalizedBriefIds = collectFinalizedBriefIds(deliverableScopeBriefs);
    const finalizedDescriptorIds = collectFinalizedDescriptorIds(deliverableScopeBriefs);
    const deliverableScopeRecords = selectDeliverableScopeDeliverables(
      deliverables,
      input.workItemId,
      deliverableWorkItemAttribution,
      finalizedBriefIds,
      finalizedDescriptorIds,
    );
    const hydratedDeliverables = suppressShadowedOrchestratorBriefPackets(
      appendSynthesizedBriefDeliverables(
        appendSynthesizedHandoffDeliverables(deliverableScopeRecords, scopedHandoffs),
        deliverableScopeBriefs,
        linkedWorkItemIdSet,
      ),
      deliverableScopeBriefs,
    );

    const normalizedDeliverables = suppressMirroredWorkflowRollupDuplicates(
      hydratedDeliverables.map(normalizeDeliverableTargets),
      input.workItemId,
    );

    const orderedDeliverables = [...normalizedDeliverables].sort((left, right) =>
      compareDeliverables(left, right),
    );
    const visibleDeliverables = orderedDeliverables.filter((deliverable) =>
      shouldExposeCurrentDeliverable(
        deliverable,
        incompleteWorkItemIdSet,
        finalizedBriefIds,
        finalizedDescriptorIds,
      ),
    );
    const page = paginateOrderedItems(visibleDeliverables, limit, input.after, (deliverable) => ({
      timestamp: deliverable.updated_at ?? deliverable.created_at,
      id: deliverable.descriptor_id,
    }));
    const allDeliverables = orderedDeliverables.map((deliverable) =>
      normalizeDeliverableForPresentation(deliverable, incompleteWorkItemIdSet),
    );
    const pagedDeliverables = page.items.map((deliverable) =>
      normalizeDeliverableForPresentation(deliverable, incompleteWorkItemIdSet),
    );
    return {
      final_deliverables: page.items
        .filter((deliverable) =>
        isCurrentFinalDeliverable(
          deliverable,
          incompleteWorkItemIdSet,
          allowIncompleteReclassification,
          finalizedBriefIds,
          finalizedDescriptorIds,
        ),
        )
        .map((deliverable) =>
          normalizeDeliverableForPresentation(deliverable, incompleteWorkItemIdSet),
        ),
      in_progress_deliverables: page.items
        .filter((deliverable) =>
          !isCurrentFinalDeliverable(
            deliverable,
            incompleteWorkItemIdSet,
            allowIncompleteReclassification,
            finalizedBriefIds,
            finalizedDescriptorIds,
          ),
        )
        .map((deliverable) =>
          normalizeDeliverableForPresentation(deliverable, incompleteWorkItemIdSet),
        ),
      working_handoffs: deliverableScopeBriefs.filter(isDeliverableBrief),
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

function selectDeliverableScopeRecords<T>(
  records: T[],
  workItemId: string | undefined,
  readWorkItemId: (record: T) => string | null,
  shouldIncludeChildScopeRecord: (record: T) => boolean,
): T[] {
  if (workItemId) {
    return filterRecordsForRequestedScope(records, workItemId, readWorkItemId);
  }

  const workflowRollupRecords = records.filter((record) => {
    const recordWorkItemId = readWorkItemId(record);
    return recordWorkItemId === null || shouldIncludeChildScopeRecord(record);
  });

  return workflowRollupRecords.length > 0 ? workflowRollupRecords : records;
}

function selectDeliverableScopeDeliverables(
  deliverables: WorkflowDeliverableRecord[],
  workItemId: string | undefined,
  attribution: DeliverableWorkItemAttribution,
  finalizedBriefIds: Set<string>,
  finalizedDescriptorIds: Set<string>,
): WorkflowDeliverableRecord[] {
  if (!workItemId) {
    return selectDeliverableScopeRecords(
      deliverables,
      undefined,
      (deliverable) =>
        resolveAttributedDeliverableWorkItemId(deliverable, attribution),
      (deliverable) =>
        shouldRollUpChildScopeDeliverable(
          deliverable,
          finalizedBriefIds,
          finalizedDescriptorIds,
        ),
    );
  }

  return deliverables.filter((deliverable) => {
    const attributedWorkItemId = resolveAttributedDeliverableWorkItemId(
      deliverable,
      attribution,
    );
    if (attributedWorkItemId === null) {
      return true;
    }
    if (attributedWorkItemId === workItemId) {
      return true;
    }
    return readRollupSourceWorkItemId(deliverable) === workItemId;
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
  linkedWorkItemIds: Set<string>,
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
    if (!shouldSynthesizeBriefDeliverable(brief, linkedWorkItemIds)) {
      continue;
    }
    if (existingBriefIds.has(brief.id)) {
      continue;
    }
    const scopeKey = buildDeliverableScopeKey(resolveDeliverableWorkItemId(brief, linkedWorkItemIds));
    if (existingFinalPacketScopes.has(scopeKey)) {
      continue;
    }
    if (isOrchestratorBrief(brief) && existingPacketScopes.has(scopeKey)) {
      continue;
    }
    records.push(buildBriefPacketDeliverable(brief, linkedWorkItemIds));
    existingFinalPacketScopes.add(scopeKey);
    existingPacketScopes.add(scopeKey);
  }

  return records;
}

function suppressShadowedOrchestratorBriefPackets(
  deliverables: WorkflowDeliverableRecord[],
  briefs: WorkflowOperatorBriefRecord[],
): WorkflowDeliverableRecord[] {
  const briefById = new Map(
    briefs.map((brief) => [brief.id, brief] as const),
  );
  const canonicalPacketScopes = new Set(
    deliverables
      .filter((deliverable) => isCanonicalFinalPacket(deliverable))
      .map((deliverable) => buildDeliverableScopeKey(readOptionalString(deliverable.work_item_id))),
  );
  return deliverables.filter((deliverable) => {
    if (!isOrchestratorBriefPacket(deliverable, briefById)) {
      return true;
    }
    const scopeKey = buildDeliverableScopeKey(readOptionalString(deliverable.work_item_id));
    return !canonicalPacketScopes.has(scopeKey);
  });
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
  linkedWorkItemIds: Set<string>,
): WorkflowDeliverableRecord {
  const workItemId = resolveDeliverableWorkItemId(brief, linkedWorkItemIds);
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

function shouldSynthesizeBriefDeliverable(
  brief: WorkflowOperatorBriefRecord,
  linkedWorkItemIds: Set<string>,
): boolean {
  const attributedWorkItemId = resolveDeliverableWorkItemId(brief, linkedWorkItemIds);
  return (
    isDeliverableBrief(brief)
    && isDeliverableOutcomeStatus(readOptionalString(brief.status_kind))
    && (
      !isWorkflowScopedOrchestratorBriefLinkedToChildScope(brief)
      || attributedWorkItemId !== null
    )
  );
}

function shouldRollUpChildScopeBrief(
  brief: WorkflowOperatorBriefRecord,
  linkedWorkItemIds: Set<string>,
): boolean {
  const statusKind = readOptionalString(brief.status_kind);
  return isDeliverableBrief(brief)
    && (statusKind === 'in_progress' || isDeliverableOutcomeStatus(statusKind))
    && resolveDeliverableWorkItemId(brief, linkedWorkItemIds) !== null;
}

function shouldRollUpChildScopeDeliverable(
  deliverable: WorkflowDeliverableRecord,
  finalizedBriefIds: Set<string>,
  finalizedDescriptorIds: Set<string>,
): boolean {
  return isFinalDeliverable(deliverable, finalizedBriefIds, finalizedDescriptorIds);
}

function isFinalDeliverable(
  deliverable: WorkflowDeliverableRecord,
  finalizedBriefIds: Set<string>,
  finalizedDescriptorIds: Set<string>,
): boolean {
  if (isSupersededDeliverable(deliverable)) {
    return false;
  }
  return (
    readOptionalString(deliverable.delivery_stage) === 'final' ||
    readOptionalString(deliverable.state) === 'final' ||
    finalizedBriefIds.has(deliverable.source_brief_id ?? '') ||
    finalizedDescriptorIds.has(deliverable.descriptor_id)
  );
}

function isCurrentFinalDeliverable(
  deliverable: WorkflowDeliverableRecord,
  incompleteWorkItemIds: Set<string>,
  allowIncompleteReclassification: boolean,
  finalizedBriefIds: Set<string>,
  finalizedDescriptorIds: Set<string>,
): boolean {
  if (!isFinalDeliverable(deliverable, finalizedBriefIds, finalizedDescriptorIds)) {
    return false;
  }
  return !isIncompleteReclassifiedDeliverable(
    deliverable,
    incompleteWorkItemIds,
    allowIncompleteReclassification,
  );
}

function isStoredFinalDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  return !isSupersededDeliverable(deliverable) && (
    readOptionalString(deliverable.delivery_stage) === 'final'
    || readOptionalString(deliverable.state) === 'final'
  );
}

function isCanonicalFinalPacket(deliverable: WorkflowDeliverableRecord): boolean {
  if (!isPacketLikeDeliverable(deliverable) || !isStoredFinalDeliverable(deliverable)) {
    return false;
  }
  return readOptionalString(deliverable.descriptor_kind) !== 'brief_packet';
}

function shouldExposeCurrentDeliverable(
  deliverable: WorkflowDeliverableRecord,
  incompleteWorkItemIds: Set<string>,
  finalizedBriefIds: Set<string>,
  finalizedDescriptorIds: Set<string>,
): boolean {
  if (isSupersededDeliverable(deliverable)) {
    return false;
  }

  const workItemId = readOptionalString(deliverable.work_item_id);
  return !(
    workItemId
    && incompleteWorkItemIds.has(workItemId)
    && isFinalDeliverable(deliverable, finalizedBriefIds, finalizedDescriptorIds)
    && !shouldKeepVisibleDuringIncompleteWorkItem(deliverable)
  );
}

function isIncompleteReclassifiedDeliverable(
  deliverable: WorkflowDeliverableRecord,
  incompleteWorkItemIds: Set<string>,
  allowIncompleteReclassification: boolean,
): boolean {
  if (!allowIncompleteReclassification) {
    return false;
  }
  const workItemId = readOptionalString(deliverable.work_item_id);
  return Boolean(
    workItemId
    && incompleteWorkItemIds.has(workItemId)
    && shouldKeepVisibleDuringIncompleteWorkItem(deliverable)
  );
}

function shouldKeepVisibleDuringIncompleteWorkItem(
  deliverable: WorkflowDeliverableRecord,
): boolean {
  if (!isStoredFinalDeliverable(deliverable)) {
    return false;
  }
  const descriptorKind = readOptionalString(deliverable.descriptor_kind);
  return descriptorKind !== 'brief_packet' && descriptorKind !== 'handoff_packet';
}

function isSupersededDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  return readOptionalString(deliverable.state) === 'superseded';
}

function normalizeDeliverableForPresentation(
  deliverable: WorkflowDeliverableRecord,
  incompleteWorkItemIds: Set<string>,
): WorkflowDeliverableRecord {
  if (isSyntheticDerivedDeliverable(deliverable) || !isStoredFinalDeliverable(deliverable)) {
    return deliverable;
  }

  const workItemId = readOptionalString(deliverable.work_item_id);
  if (!workItemId || !incompleteWorkItemIds.has(workItemId)) {
    return deliverable;
  }

  return {
    ...deliverable,
    delivery_stage: 'in_progress',
    state: normalizeIncompleteDeliverableState(readOptionalString(deliverable.state)),
  };
}

function isSyntheticDerivedDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  return SYNTHETIC_DERIVED_DELIVERABLE_PREFIXES.some((prefix) =>
    deliverable.descriptor_id.startsWith(prefix),
  );
}

function normalizeIncompleteDeliverableState(state: string | null): string {
  if (state === 'final') {
    return 'approved';
  }
  return state ?? 'draft';
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

function isOrchestratorBriefPacket(
  deliverable: WorkflowDeliverableRecord,
  briefById: Map<string, WorkflowOperatorBriefRecord>,
): boolean {
  if (readOptionalString(deliverable.descriptor_kind) !== 'brief_packet') {
    return false;
  }
  const briefId = readOptionalString(deliverable.source_brief_id);
  if (!briefId) {
    return false;
  }
  const brief = briefById.get(briefId);
  return brief ? isOrchestratorBrief(brief) : false;
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

function resolveDeliverableWorkItemId(
  brief: WorkflowOperatorBriefRecord,
  linkedWorkItemIds: Set<string>,
): string | null {
  const storedWorkItemId = readOptionalString(brief.work_item_id);
  if (storedWorkItemId) {
    return storedWorkItemId;
  }
  if (!isWorkflowScopedOrchestratorBriefLinkedToChildScope(brief)) {
    return null;
  }
  const candidateIds = (brief.linked_target_ids ?? [])
    .map((targetId) => readOptionalString(targetId))
    .filter((targetId): targetId is string => targetId !== null && targetId !== brief.workflow_id)
    .filter((targetId) => linkedWorkItemIds.has(targetId));
  return candidateIds.length === 1 ? candidateIds[0] : null;
}

interface DeliverableWorkItemAttribution {
  readonly byBriefId: ReadonlyMap<string, string>;
  readonly byDescriptorId: ReadonlyMap<string, string>;
}

function buildDeliverableWorkItemAttribution(
  briefs: WorkflowOperatorBriefRecord[],
  linkedWorkItemIds: Set<string>,
): DeliverableWorkItemAttribution {
  const byBriefId = new Map<string, string>();
  const byDescriptorAssignments = new Map<string, string | null>();
  for (const brief of briefs) {
    const workItemId = resolveDeliverableWorkItemId(brief, linkedWorkItemIds);
    if (!workItemId) {
      continue;
    }
    byBriefId.set(brief.id, workItemId);
    for (const descriptorId of brief.related_output_descriptor_ids ?? []) {
      const normalizedDescriptorId = readOptionalString(descriptorId);
      if (!normalizedDescriptorId) {
        continue;
      }
      const currentAssignment = byDescriptorAssignments.get(normalizedDescriptorId);
      if (currentAssignment === undefined) {
        byDescriptorAssignments.set(normalizedDescriptorId, workItemId);
        continue;
      }
      if (currentAssignment !== workItemId) {
        byDescriptorAssignments.set(normalizedDescriptorId, null);
      }
    }
  }
  const byDescriptorId = new Map<string, string>();
  for (const [descriptorId, workItemId] of byDescriptorAssignments.entries()) {
    if (workItemId) {
      byDescriptorId.set(descriptorId, workItemId);
    }
  }
  return { byBriefId, byDescriptorId };
}

function resolveAttributedDeliverableWorkItemId(
  deliverable: WorkflowDeliverableRecord,
  attribution: DeliverableWorkItemAttribution,
): string | null {
  const storedWorkItemId = readOptionalString(deliverable.work_item_id);
  if (storedWorkItemId) {
    return storedWorkItemId;
  }
  const sourceBriefId = readOptionalString(deliverable.source_brief_id);
  if (sourceBriefId) {
    const attributedWorkItemId = attribution.byBriefId.get(sourceBriefId);
    if (attributedWorkItemId) {
      return attributedWorkItemId;
    }
  }
  return attribution.byDescriptorId.get(deliverable.descriptor_id) ?? null;
}

function collectLinkedTargetCandidateIds(briefs: WorkflowOperatorBriefRecord[]): string[] {
  const candidateIds = new Set<string>();
  for (const brief of briefs) {
    if (!isWorkflowScopedOrchestratorBriefLinkedToChildScope(brief)) {
      continue;
    }
    for (const targetId of brief.linked_target_ids ?? []) {
      const normalizedTargetId = readOptionalString(targetId);
      if (normalizedTargetId && normalizedTargetId !== brief.workflow_id) {
        candidateIds.add(normalizedTargetId);
      }
    }
  }
  return [...candidateIds];
}

function normalizeDeliverableTargets(
  deliverable: WorkflowDeliverableRecord,
): WorkflowDeliverableRecord {
  return {
    ...deliverable,
    primary_target: normalizeDeliverableTarget(asTargetRecord(deliverable.primary_target)),
    secondary_targets: normalizeDeliverableTargetList(deliverable.secondary_targets),
  };
}

function normalizeDeliverableTargetList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value
      .map(asTargetRecord)
      .filter(hasTargetFields)
      .map(normalizeDeliverableTarget);
  }

  const singleTarget = asTargetRecord(value);
  return hasTargetFields(singleTarget) ? [normalizeDeliverableTarget(singleTarget)] : [];
}

function asTargetRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function hasTargetFields(target: Record<string, unknown>): boolean {
  return Object.keys(target).length > 0;
}

function normalizeDeliverableTarget(target: Record<string, unknown>): Record<string, unknown> {
  const normalizedUrl = normalizeArtifactPreviewUrl(readOptionalString(target.url));
  return normalizedUrl === null ? target : { ...target, url: normalizedUrl };
}

function normalizeArtifactPreviewUrl(url: string | null): string | null {
  if (!url) {
    return url;
  }

  let parsed: URL;
  try {
    parsed = new URL(url, 'http://dashboard.local');
  } catch {
    return url;
  }

  const deprecatedMatch = parsed.pathname.match(/^\/artifacts\/tasks\/([^/]+)\/([^/?#]+)$/);
  if (!deprecatedMatch) {
    return serializeNormalizedUrl(parsed);
  }

  parsed.pathname = `/api/v1/tasks/${encodeURIComponent(deprecatedMatch[1])}/artifacts/${encodeURIComponent(deprecatedMatch[2])}/preview`;
  parsed.searchParams.delete('return_to');
  parsed.searchParams.delete('return_source');
  return serializeNormalizedUrl(parsed);
}

function suppressMirroredWorkflowRollupDuplicates(
  deliverables: WorkflowDeliverableRecord[],
  selectedWorkItemId?: string,
): WorkflowDeliverableRecord[] {
  const workflowRollupSources = new Set(
    deliverables
      .filter((deliverable) => readOptionalString(deliverable.work_item_id) === null)
      .map(readRollupSourceDescriptorId)
      .filter((descriptorId): descriptorId is string => descriptorId !== null),
  );
  return deliverables.filter((deliverable) => {
    const workItemId = readOptionalString(deliverable.work_item_id);
    if (selectedWorkItemId) {
      if (workItemId !== null) {
        return true;
      }
      return (
        readRollupSourceWorkItemId(deliverable) === null
        || readRollupSourceWorkItemId(deliverable) === selectedWorkItemId
      );
    }
    return !(workItemId !== null && workflowRollupSources.has(deliverable.descriptor_id));
  });
}

function serializeNormalizedUrl(parsed: URL): string {
  return parsed.origin === 'http://dashboard.local'
    ? `${parsed.pathname}${parsed.search}${parsed.hash}`
    : parsed.toString();
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

function readRollupSourceDescriptorId(deliverable: WorkflowDeliverableRecord): string | null {
  return readOptionalString(asRecord(deliverable.content_preview)[ROLLUP_SOURCE_DESCRIPTOR_ID_KEY]);
}

function readRollupSourceWorkItemId(deliverable: WorkflowDeliverableRecord): string | null {
  return readOptionalString(asRecord(deliverable.content_preview)[ROLLUP_SOURCE_WORK_ITEM_ID_KEY]);
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
  if (isWorkflowScopedOrchestratorBriefLinkedToChildScope(brief)) {
    return 'Promoted from workflow brief';
  }
  if (isOrchestratorBrief(brief) && readOptionalString(brief.work_item_id) !== null) {
    return 'Promoted from work item brief';
  }
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
