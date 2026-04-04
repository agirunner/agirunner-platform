import type { WorkflowDeliverableRecord } from '../../workflow-deliverables/workflow-deliverable-service.js';

import { isFinalDeliverable } from './classification.js';
import {
  isWrapperLikeDeliverableTitle,
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
  const groupsByKey = new Map<string, WorkflowDeliverableRecord[]>();
  const preferredByKey = new Map<string, WorkflowDeliverableRecord>();

  for (const deliverable of deliverables) {
    const duplicateKey = buildDuplicateKey(deliverable, input.readOwnerWorkItemId);
    if (!duplicateKey) {
      continue;
    }
    const group = groupsByKey.get(duplicateKey);
    if (group) {
      group.push(deliverable);
    } else {
      groupsByKey.set(duplicateKey, [deliverable]);
    }
  }

  for (const [duplicateKey, candidates] of groupsByKey.entries()) {
    if (candidates.length === 0) {
      continue;
    }
    const preferred = candidates.reduce((current, candidate) =>
      choosePreferredDeliverable(current, candidate, input));
    preferredByKey.set(
      duplicateKey,
      harmonizePreferredDeliverable(preferred, candidates, input),
    );
  }

  if (preferredByKey.size === 0) {
    return deliverables;
  }

  const emittedKeys = new Set<string>();
  return deliverables.flatMap((deliverable) => {
    const duplicateKey = buildDuplicateKey(deliverable, input.readOwnerWorkItemId);
    if (!duplicateKey) {
      return [deliverable];
    }
    if (emittedKeys.has(duplicateKey)) {
      return [];
    }
    const current = preferredByKey.get(duplicateKey);
    if (!current || current.descriptor_id !== deliverable.descriptor_id) {
      return [];
    }
    emittedKeys.add(duplicateKey);
    return [current];
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
  const scopeDifference = scopePreference(candidate, input.selectedWorkItemId)
    - scopePreference(current, input.selectedWorkItemId);
  if (scopeDifference > 0) {
    return candidate;
  }
  if (scopeDifference < 0) {
    return current;
  }

  const representationDifference = contentRepresentationPreference(candidate)
    - contentRepresentationPreference(current);
  if (representationDifference > 0) {
    return candidate;
  }
  if (representationDifference < 0) {
    return current;
  }

  const currentIsFinal = isFinalDeliverable(
    current,
    new Set(input.finalizedBriefIds),
    new Set(input.finalizedDescriptorIds),
  );
  const candidateIsFinal = isFinalDeliverable(
    candidate,
    new Set(input.finalizedBriefIds),
    new Set(input.finalizedDescriptorIds),
  );
  if (candidateIsFinal && !currentIsFinal) {
    return candidate;
  }
  if (currentIsFinal && !candidateIsFinal) {
    return current;
  }

  const currentSourceBriefBonus = readOptionalString(current.source_brief_id) === null ? 0 : 1;
  const candidateSourceBriefBonus = readOptionalString(candidate.source_brief_id) === null ? 0 : 1;
  if (candidateSourceBriefBonus > currentSourceBriefBonus) {
    return candidate;
  }
  if (candidateSourceBriefBonus < currentSourceBriefBonus) {
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

function harmonizePreferredDeliverable(
  preferred: WorkflowDeliverableRecord,
  candidates: WorkflowDeliverableRecord[],
  input: DeduplicateDeliverablesInput,
): WorkflowDeliverableRecord {
  const representative = selectRepresentativeDeliverable(candidates, input.selectedWorkItemId);
  const finalizedLifecycle = selectFinalizedLifecycleCandidate(candidates, input);

  let merged = preferred;
  if (representative && contentRepresentationPreference(representative) > contentRepresentationPreference(preferred)) {
    merged = {
      ...merged,
      title: representative.title,
      summary_brief: representative.summary_brief ?? merged.summary_brief,
    };
  }
  if (finalizedLifecycle && !isFinalDeliverable(merged, new Set(input.finalizedBriefIds), new Set(input.finalizedDescriptorIds))) {
    merged = {
      ...merged,
      delivery_stage: finalizedLifecycle.delivery_stage,
      state: finalizedLifecycle.state,
      updated_at: finalizedLifecycle.updated_at ?? finalizedLifecycle.created_at,
    };
  }
  return merged;
}

function selectRepresentativeDeliverable(
  candidates: WorkflowDeliverableRecord[],
  selectedWorkItemId?: string,
): WorkflowDeliverableRecord | null {
  const substantiveCandidates = candidates.filter(hasSubstantiveTarget);
  if (substantiveCandidates.length === 0) {
    return null;
  }
  return substantiveCandidates.reduce((current, candidate) => {
    const representationDifference = contentRepresentationPreference(candidate)
      - contentRepresentationPreference(current);
    if (representationDifference > 0) {
      return candidate;
    }
    if (representationDifference < 0) {
      return current;
    }
    const scopeDifference = scopePreference(candidate, selectedWorkItemId)
      - scopePreference(current, selectedWorkItemId);
    if (scopeDifference > 0) {
      return candidate;
    }
    if (scopeDifference < 0) {
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
  });
}

function selectFinalizedLifecycleCandidate(
  candidates: WorkflowDeliverableRecord[],
  input: DeduplicateDeliverablesInput,
): WorkflowDeliverableRecord | null {
  const finalizedCandidates = candidates.filter((candidate) =>
    isFinalDeliverable(candidate, new Set(input.finalizedBriefIds), new Set(input.finalizedDescriptorIds)));
  if (finalizedCandidates.length === 0) {
    return null;
  }
  return finalizedCandidates.reduce((current, candidate) => {
    const currentTimestamp = current.updated_at ?? current.created_at;
    const candidateTimestamp = candidate.updated_at ?? candidate.created_at;
    if (candidateTimestamp > currentTimestamp) {
      return candidate;
    }
    if (candidateTimestamp < currentTimestamp) {
      return current;
    }
    return candidate.descriptor_id > current.descriptor_id ? candidate : current;
  });
}

function contentRepresentationPreference(
  deliverable: WorkflowDeliverableRecord,
): number {
  if (!hasSubstantiveTarget(deliverable)) {
    return 0;
  }
  let score = 1;
  if (!isWrapperLikeDeliverableTitle(readOptionalString(deliverable.title))) {
    score += 2;
  }
  if (readOptionalString(deliverable.source_brief_id) !== null) {
    score += 1;
  }
  return score;
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
