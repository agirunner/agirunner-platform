import type { WorkflowDeliverableRecord } from '../../workflow-deliverables/workflow-deliverable-service.js';

import { asRecord, readOptionalString } from './workflow-workspace-common.js';
import { normalizeDeliverableTargetPath } from '../workflow-deliverables-service/shared.js';

export function mergeVisibleDeliverablesWithFallbacks(
  visibleDeliverables: WorkflowDeliverableRecord[],
  fallbackDeliverables: WorkflowDeliverableRecord[],
): WorkflowDeliverableRecord[] {
  const fallbackByIdentity = new Map<string, WorkflowDeliverableRecord>();
  for (const deliverable of fallbackDeliverables) {
    const identityKey = readDeliverableIdentityKey(deliverable);
    if (!identityKey || fallbackByIdentity.has(identityKey)) {
      continue;
    }
    fallbackByIdentity.set(identityKey, deliverable);
  }

  return visibleDeliverables.map((deliverable) => {
    const identityKey = readDeliverableIdentityKey(deliverable);
    if (!identityKey) {
      return normalizeContentBackedPacketDeliverable(deliverable);
    }
    const fallback = fallbackByIdentity.get(identityKey);
    if (!fallback) {
      return normalizeContentBackedPacketDeliverable(deliverable);
    }
    if (shouldOverlayVisibleDeliverable(deliverable, fallback)) {
      return overlayVisibleDeliverableWithFallback(deliverable, fallback);
    }
    return normalizeContentBackedPacketDeliverable(
      mergeVisibleDeliverableMetadata(deliverable, fallback),
    );
  });
}

export function readDeliverableIdentityKey(deliverable: WorkflowDeliverableRecord): string | null {
  const primaryTarget = asRecord(deliverable.primary_target);
  const targetPath = normalizeDeliverableTargetPath(readOptionalString(primaryTarget.path));
  if (targetPath) {
    return `path:${targetPath}`;
  }
  const artifactId = readOptionalString(primaryTarget.artifact_id);
  if (artifactId) {
    return `artifact:${artifactId}`;
  }
  const targetUrl = readOptionalString(primaryTarget.url);
  if (targetUrl) {
    return `url:${targetUrl}`;
  }
  return null;
}

function shouldOverlayVisibleDeliverable(
  visibleDeliverable: WorkflowDeliverableRecord,
  fallbackDeliverable: WorkflowDeliverableRecord,
): boolean {
  return hasConcreteContentTarget(fallbackDeliverable)
    && (
      isInlineSummaryPlaceholderDeliverable(visibleDeliverable)
      || (
        isPacketLikeWorkspaceDeliverable(visibleDeliverable)
        && !isPacketLikeWorkspaceDeliverable(fallbackDeliverable)
      )
    );
}

function overlayVisibleDeliverableWithFallback(
  visibleDeliverable: WorkflowDeliverableRecord,
  fallbackDeliverable: WorkflowDeliverableRecord,
): WorkflowDeliverableRecord {
  const visiblePreview = asRecord(visibleDeliverable.content_preview);
  const fallbackPreview = asRecord(fallbackDeliverable.content_preview);
  return {
    ...visibleDeliverable,
    descriptor_id: fallbackDeliverable.descriptor_id,
    descriptor_kind: fallbackDeliverable.descriptor_kind,
    preview_capabilities: fallbackDeliverable.preview_capabilities,
    primary_target: fallbackDeliverable.primary_target,
    secondary_targets: fallbackDeliverable.secondary_targets,
    content_preview: {
      ...fallbackPreview,
      ...visiblePreview,
      source_role_name:
        readOptionalString(visiblePreview.source_role_name)
        ?? readOptionalString(fallbackPreview.source_role_name)
        ?? null,
    },
    created_at: fallbackDeliverable.created_at,
    updated_at: fallbackDeliverable.updated_at,
  };
}

function mergeVisibleDeliverableMetadata(
  visibleDeliverable: WorkflowDeliverableRecord,
  fallbackDeliverable: WorkflowDeliverableRecord,
): WorkflowDeliverableRecord {
  const visiblePreview = asRecord(visibleDeliverable.content_preview);
  const fallbackPreview = asRecord(fallbackDeliverable.content_preview);
  const sourceRoleName =
    readOptionalString(visiblePreview.source_role_name)
    ?? readOptionalString(fallbackPreview.source_role_name);
  if (!sourceRoleName) {
    return visibleDeliverable;
  }
  return {
    ...visibleDeliverable,
    content_preview: {
      ...visiblePreview,
      source_role_name: sourceRoleName,
    },
  };
}

function normalizeContentBackedPacketDeliverable(
  deliverable: WorkflowDeliverableRecord,
): WorkflowDeliverableRecord {
  if (!isPacketLikeWorkspaceDeliverable(deliverable) || !hasConcreteContentTarget(deliverable)) {
    return deliverable;
  }
  const targetKind = readOptionalString(asRecord(deliverable.primary_target).target_kind);
  if (!targetKind || targetKind === 'inline_summary') {
    return deliverable;
  }
  return {
    ...deliverable,
    descriptor_kind: targetKind,
  };
}

function isInlineSummaryPlaceholderDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  const primaryTarget = asRecord(deliverable.primary_target);
  return readOptionalString(primaryTarget.target_kind) === 'inline_summary'
    && readOptionalString(primaryTarget.path) !== null;
}

function isPacketLikeWorkspaceDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  const descriptorKind = readOptionalString(deliverable.descriptor_kind);
  return descriptorKind === 'deliverable_packet'
    || descriptorKind === 'brief_packet'
    || descriptorKind === 'handoff_packet';
}

function hasConcreteContentTarget(deliverable: WorkflowDeliverableRecord): boolean {
  const primaryTarget = asRecord(deliverable.primary_target);
  return readOptionalString(primaryTarget.target_kind) !== 'inline_summary'
    || readOptionalString(primaryTarget.artifact_id) !== null
    || readOptionalString(primaryTarget.url) !== null
    || readOptionalString(primaryTarget.repo_ref) !== null;
}
