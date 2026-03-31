import type { WorkflowDeliverableRecord } from '../../workflow-deliverable-service.js';
import type { WorkflowOperatorBriefRecord } from '../../workflow-operator-brief-service.js';

import {
  isPacketLikeDeliverable,
  SYNTHETIC_DERIVED_DELIVERABLE_PREFIXES,
} from './shared.js';
import { readOptionalString } from '../workflow-workspace/workflow-workspace-common.js';

export function isDeliverableBrief(brief: WorkflowOperatorBriefRecord): boolean {
  return readOptionalString(brief.brief_scope) === 'deliverable_context';
}

export function isDeliverableOutcomeStatus(statusKind: string | null): boolean {
  return statusKind === 'completed' || statusKind === 'final' || statusKind === 'approved';
}

export function isOrchestratorRole(value: string | null | undefined): boolean {
  return readOptionalString(value)?.toLowerCase() === 'orchestrator';
}

export function isOrchestratorBrief(brief: WorkflowOperatorBriefRecord): boolean {
  return isOrchestratorRole(brief.source_kind) || isOrchestratorRole(brief.source_role_name);
}

export function isWorkflowScopedOrchestratorBriefLinkedToChildScope(
  brief: WorkflowOperatorBriefRecord,
): boolean {
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

export function isFinalDeliverable(
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

export function isCurrentFinalDeliverable(
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

export function isStoredFinalDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  return !isSupersededDeliverable(deliverable) && (
    readOptionalString(deliverable.delivery_stage) === 'final'
    || readOptionalString(deliverable.state) === 'final'
  );
}

export function isCanonicalFinalPacket(deliverable: WorkflowDeliverableRecord): boolean {
  if (!isPacketLikeDeliverable(deliverable) || !isStoredFinalDeliverable(deliverable)) {
    return false;
  }
  return readOptionalString(deliverable.descriptor_kind) !== 'brief_packet';
}

export function shouldExposeCurrentDeliverable(
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

export function isIncompleteReclassifiedDeliverable(
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
    && shouldKeepVisibleDuringIncompleteWorkItem(deliverable),
  );
}

export function shouldKeepVisibleDuringIncompleteWorkItem(
  deliverable: WorkflowDeliverableRecord,
): boolean {
  if (!isStoredFinalDeliverable(deliverable)) {
    return false;
  }
  const descriptorKind = readOptionalString(deliverable.descriptor_kind);
  return descriptorKind !== 'brief_packet' && descriptorKind !== 'handoff_packet';
}

export function isSupersededDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  return readOptionalString(deliverable.state) === 'superseded';
}

export function isSyntheticDerivedDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  return SYNTHETIC_DERIVED_DELIVERABLE_PREFIXES.some((prefix) =>
    deliverable.descriptor_id.startsWith(prefix),
  );
}

export function normalizeIncompleteDeliverableState(state: string | null): string {
  if (state === 'final') {
    return 'approved';
  }
  return state ?? 'draft';
}

export function normalizeDeliverableForPresentation(
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
