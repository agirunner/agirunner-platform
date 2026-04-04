import type { WorkflowDeliverableRecord } from '../../workflow-deliverables/workflow-deliverable-service.js';

import { isFinalDeliverable } from './classification.js';
import {
  isPacketLikeDeliverable,
  isInternalReferenceTargetPath,
  readDeliverableContentIdentityKey,
  readRollupSourceWorkItemId,
} from './shared.js';
import { readOptionalString } from '../workflow-workspace/workflow-workspace-common.js';

interface DeduplicateDeliverablesInput {
  readonly selectedWorkItemId?: string;
  readonly finalizedBriefIds: ReadonlySet<string>;
  readonly finalizedDescriptorIds: ReadonlySet<string>;
  readonly readOwnerWorkItemId: (deliverable: WorkflowDeliverableRecord) => string | null;
}

export function deduplicateScopedDeliverables(
  deliverables: WorkflowDeliverableRecord[],
  input: DeduplicateDeliverablesInput,
): WorkflowDeliverableRecord[] {
  const preferredByKey = new Map<string, WorkflowDeliverableRecord>();

  for (const deliverable of deliverables) {
    const duplicateKey = buildDuplicateKey(deliverable, input.readOwnerWorkItemId);
    if (!duplicateKey) {
      continue;
    }
    const current = preferredByKey.get(duplicateKey);
    if (!current) {
      preferredByKey.set(duplicateKey, deliverable);
      continue;
    }
    preferredByKey.set(
      duplicateKey,
      choosePreferredDeliverable(current, deliverable, input),
    );
  }

  if (preferredByKey.size === 0) {
    return deliverables;
  }

  return deliverables.filter((deliverable) => {
    const duplicateKey = buildDuplicateKey(deliverable, input.readOwnerWorkItemId);
    if (!duplicateKey) {
      return true;
    }
    return preferredByKey.get(duplicateKey)?.descriptor_id === deliverable.descriptor_id;
  });
}

export function suppressPacketWrappersWhenContentExists(
  deliverables: WorkflowDeliverableRecord[],
  readOwnerWorkItemId: (deliverable: WorkflowDeliverableRecord) => string | null,
): WorkflowDeliverableRecord[] {
  const contentIdentityKeysWithNonPacketContent = new Set(
    deliverables
      .filter((deliverable) => !isPacketLikeDeliverable(deliverable) && hasSubstantiveTarget(deliverable))
      .map((deliverable) => readDeliverableContentIdentityKey(deliverable))
      .filter((identityKey): identityKey is string => identityKey !== null),
  );
  const ownerKeysWithContent = new Set(
    deliverables
      .filter(hasSubstantiveTarget)
      .map((deliverable) => buildOwnerScopeKey(deliverable, readOwnerWorkItemId))
      .filter((ownerKey): ownerKey is string => ownerKey !== null),
  );

  if (ownerKeysWithContent.size === 0) {
    return deliverables;
  }

  return deliverables.filter((deliverable) => {
    if (!isPacketLikeDeliverable(deliverable)) {
      return true;
    }

    const identityKey = readDeliverableContentIdentityKey(deliverable);
    if (identityKey && contentIdentityKeysWithNonPacketContent.has(identityKey)) {
      return false;
    }
    if (hasSubstantiveTarget(deliverable)) {
      return true;
    }

    const ownerKey = buildOwnerScopeKey(deliverable, readOwnerWorkItemId);
    return ownerKey === null || !ownerKeysWithContent.has(ownerKey);
  });
}

function buildDuplicateKey(
  deliverable: WorkflowDeliverableRecord,
  readOwnerWorkItemId: (deliverable: WorkflowDeliverableRecord) => string | null,
): string | null {
  const identityKey = readDeliverableContentIdentityKey(deliverable);
  if (!identityKey) {
    return null;
  }
  const ownerScopeKey = buildOwnerScopeKey(deliverable, readOwnerWorkItemId) ?? '__workflow__';
  return `${ownerScopeKey}|${identityKey}`;
}

function choosePreferredDeliverable(
  current: WorkflowDeliverableRecord,
  candidate: WorkflowDeliverableRecord,
  input: DeduplicateDeliverablesInput,
): WorkflowDeliverableRecord {
  const currentScore = scoreDeliverable(current, input);
  const candidateScore = scoreDeliverable(candidate, input);
  if (candidateScore > currentScore) {
    return candidate;
  }
  if (candidateScore < currentScore) {
    return current;
  }

  const currentTimestamp = current.updated_at ?? current.created_at;
  const candidateTimestamp = candidate.updated_at ?? candidate.created_at;
  if (candidateTimestamp > currentTimestamp) {
    return candidate;
  }
  if (candidateTimestamp < currentTimestamp) {
    return current;
  }

  return candidate.descriptor_id > current.descriptor_id ? candidate : current;
}

function scoreDeliverable(
  deliverable: WorkflowDeliverableRecord,
  input: DeduplicateDeliverablesInput,
): number {
  return (
    scopePreference(deliverable, input.selectedWorkItemId)
    + (isFinalDeliverable(
      deliverable,
      new Set(input.finalizedBriefIds),
      new Set(input.finalizedDescriptorIds),
    ) ? 100 : 0)
    + (readOptionalString(deliverable.source_brief_id) === null ? 10 : 0)
  );
}

function scopePreference(
  deliverable: WorkflowDeliverableRecord,
  selectedWorkItemId?: string,
): number {
  const directWorkItemId = readOptionalString(deliverable.work_item_id);
  const rollupSourceWorkItemId = readRollupSourceWorkItemId(deliverable);

  if (selectedWorkItemId) {
    if (directWorkItemId === selectedWorkItemId) {
      return 4;
    }
    if (directWorkItemId === null && rollupSourceWorkItemId === selectedWorkItemId) {
      return 3;
    }
    if (directWorkItemId === null) {
      return 2;
    }
    return 1;
  }

  if (directWorkItemId === null && rollupSourceWorkItemId !== null) {
    return 4;
  }
  if (directWorkItemId === null) {
    return 3;
  }
  return 1;
}

function buildOwnerScopeKey(
  deliverable: WorkflowDeliverableRecord,
  readOwnerWorkItemId: (deliverable: WorkflowDeliverableRecord) => string | null,
): string | null {
  return readOwnerWorkItemId(deliverable) ?? readRollupSourceWorkItemId(deliverable);
}

function hasSubstantiveTarget(deliverable: WorkflowDeliverableRecord): boolean {
  const primaryTarget = deliverable.primary_target;
  if (!primaryTarget || typeof primaryTarget !== 'object' || Array.isArray(primaryTarget)) {
    return false;
  }
  const target = primaryTarget as Record<string, unknown>;
  const targetPath = readOptionalString(target.path);
  return (
    (targetPath !== null && !isInternalReferenceTargetPath(targetPath))
    || readOptionalString(target.url) !== null
    || readOptionalString(target.repo_ref) !== null
    || readOptionalString(target.artifact_id) !== null
  );
}
