import type { WorkflowDeliverableRecord } from '../../workflow-deliverables/workflow-deliverable-service.js';
import type { WorkflowOperatorBriefRecord } from '../../workflow-operator/workflow-operator-brief-service.js';

import {
  isDeliverableBrief,
  isDeliverableOutcomeStatus,
  isFinalDeliverable,
  isSupersededDeliverable,
  isWorkflowScopedOrchestratorBriefLinkedToChildScope,
} from './classification.js';
import {
  asRecord,
  readOptionalString,
} from '../workflow-workspace/workflow-workspace-common.js';

export function filterRecordsForRequestedScope<T>(
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

export function selectDeliverableScopeRecords<T>(
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

export function selectDeliverableScopeDeliverables(
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
      (deliverable) => resolveAttributedDeliverableWorkItemId(deliverable, attribution),
      (deliverable) => shouldRollUpChildScopeDeliverable(
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

export function collectFinalizedBriefIds(briefs: WorkflowOperatorBriefRecord[]): Set<string> {
  return new Set(
    briefs
      .filter((brief) => isDeliverableOutcomeStatus(readOptionalString(brief.status_kind)))
      .map((brief) => brief.id),
  );
}

export function collectFinalizedDescriptorIds(briefs: WorkflowOperatorBriefRecord[]): Set<string> {
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

export function shouldSynthesizeBriefDeliverable(
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

export function shouldRollUpChildScopeBrief(
  brief: WorkflowOperatorBriefRecord,
  linkedWorkItemIds: Set<string>,
): boolean {
  const statusKind = readOptionalString(brief.status_kind);
  return isDeliverableBrief(brief)
    && (statusKind === 'in_progress' || isDeliverableOutcomeStatus(statusKind))
    && resolveDeliverableWorkItemId(brief, linkedWorkItemIds) !== null;
}

export function shouldRollUpChildScopeDeliverable(
  deliverable: WorkflowDeliverableRecord,
  finalizedBriefIds: Set<string>,
  finalizedDescriptorIds: Set<string>,
): boolean {
  return !isSupersededDeliverable(deliverable)
    && (
      readOptionalString(deliverable.work_item_id) !== null
      || isFinalDeliverable(deliverable, finalizedBriefIds, finalizedDescriptorIds)
    );
}

export function resolveDeliverableWorkItemId(
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

export interface DeliverableWorkItemAttribution {
  readonly byBriefId: ReadonlyMap<string, string>;
  readonly byDescriptorId: ReadonlyMap<string, string>;
}

export function buildDeliverableWorkItemAttribution(
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

export function resolveAttributedDeliverableWorkItemId(
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

export function collectLinkedTargetCandidateIds(briefs: WorkflowOperatorBriefRecord[]): string[] {
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

function readRollupSourceWorkItemId(deliverable: WorkflowDeliverableRecord): string | null {
  return readOptionalString(asRecord(deliverable.content_preview).rollup_source_work_item_id);
}
