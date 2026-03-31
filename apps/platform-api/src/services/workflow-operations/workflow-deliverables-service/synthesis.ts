import type { WorkflowDeliverableRecord } from '../../workflow-deliverable-service.js';
import type { WorkflowDeliverableHandoffRecord } from '../../workflow-deliverable-handoff-service.js';
import type { WorkflowOperatorBriefRecord } from '../../workflow-operator/workflow-operator-brief-service.js';

import {
  isOrchestratorBrief,
  isOrchestratorRole,
  isWorkflowScopedOrchestratorBriefLinkedToChildScope,
  isStoredFinalDeliverable,
} from './classification.js';
import {
  buildDeliverableScopeKey,
  humanizeRole,
} from './shared.js';
import {
  resolveDeliverableWorkItemId,
  shouldSynthesizeBriefDeliverable,
} from './scoping.js';
import {
  asRecord,
  humanizeToken,
  readOptionalString,
} from '../workflow-workspace/workflow-workspace-common.js';

export function appendSynthesizedHandoffDeliverables(
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

export function appendSynthesizedBriefDeliverables(
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
      .filter((deliverable) => isPacketLikeDeliverable(deliverable))
      .filter(isStoredFinalDeliverable)
      .map((deliverable) => buildDeliverableScopeKey(readOptionalString(deliverable.work_item_id))),
  );
  const existingPacketScopes = new Set(
    deliverables
      .filter((deliverable) => isPacketLikeDeliverable(deliverable))
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

export function suppressShadowedOrchestratorBriefPackets(
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

export function buildHandoffPacketDeliverable(
  handoff: WorkflowDeliverableHandoffRecord,
): WorkflowDeliverableRecord {
  const previewText = [
    handoff.summary,
    handoff.completion.trim(),
    handoff.decision_state ? `Decision: ${humanizeToken(handoff.decision_state)}` : null,
    handoff.role ? `Produced by: ${humanizeRole(handoff.role)}` : null,
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

export function buildBriefPacketDeliverable(
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

function isPacketLikeDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  const descriptorKind = readOptionalString(deliverable.descriptor_kind);
  return descriptorKind === 'handoff_packet'
    || descriptorKind === 'brief_packet'
    || descriptorKind === 'deliverable_packet';
}

function isCanonicalFinalPacket(deliverable: WorkflowDeliverableRecord): boolean {
  if (!isPacketLikeDeliverable(deliverable) || !isStoredFinalDeliverable(deliverable)) {
    return false;
  }
  return readOptionalString(deliverable.descriptor_kind) !== 'brief_packet';
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
