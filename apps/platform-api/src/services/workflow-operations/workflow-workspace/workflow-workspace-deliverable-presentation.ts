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
    title: preferVisibleDeliverableTitle(visibleDeliverable, fallbackDeliverable),
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
    created_at: preferNonEmptyTimestamp(
      visibleDeliverable.created_at,
      fallbackDeliverable.created_at,
    ),
    updated_at: preferNonEmptyTimestamp(
      visibleDeliverable.updated_at,
      fallbackDeliverable.updated_at,
    ),
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
  const title = preferVisibleDeliverableTitle(visibleDeliverable, fallbackDeliverable);
  const createdAt = preferNonEmptyTimestamp(
    visibleDeliverable.created_at,
    fallbackDeliverable.created_at,
  );
  const updatedAt = preferNonEmptyTimestamp(
    visibleDeliverable.updated_at,
    fallbackDeliverable.updated_at,
  );
  if (
    !sourceRoleName
    && title === visibleDeliverable.title
    && createdAt === visibleDeliverable.created_at
    && updatedAt === visibleDeliverable.updated_at
  ) {
    return visibleDeliverable;
  }
  return {
    ...visibleDeliverable,
    title,
    created_at: createdAt,
    updated_at: updatedAt,
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

function preferNonEmptyTimestamp(primary: string, fallback: string): string {
  return readOptionalString(primary) ?? readOptionalString(fallback) ?? '';
}

function preferVisibleDeliverableTitle(
  visibleDeliverable: WorkflowDeliverableRecord,
  fallbackDeliverable: WorkflowDeliverableRecord,
): string {
  const fallbackTitle = readOptionalString(fallbackDeliverable.title);
  if (!fallbackTitle) {
    return visibleDeliverable.title;
  }
  const visibleTitle = readOptionalString(visibleDeliverable.title);
  if (!visibleTitle) {
    return fallbackTitle;
  }
  if (isPathLikeVisibleTitle(visibleDeliverable, visibleTitle)) {
    return fallbackTitle;
  }
  if (shouldPreferFallbackDeliverableTitle(visibleTitle, fallbackTitle)) {
    return fallbackTitle;
  }
  return visibleDeliverable.title;
}

function shouldPreferFallbackDeliverableTitle(
  visibleTitle: string,
  fallbackTitle: string,
): boolean {
  return isGenericDeliverableTitle(visibleTitle) && !isGenericDeliverableTitle(fallbackTitle);
}

function isGenericDeliverableTitle(title: string): boolean {
  const tokens = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }

  const genericTokens = tokens.filter((token) => GENERIC_DELIVERABLE_TITLE_TOKENS.has(token));
  if (genericTokens.length === tokens.length) {
    return true;
  }

  const trailingToken = tokens.at(-1);
  return Boolean(
    trailingToken
      && GENERIC_DELIVERABLE_TITLE_TOKENS.has(trailingToken)
      && tokens.length <= 3
      && genericTokens.length >= tokens.length - 1,
  );
}

const GENERIC_DELIVERABLE_TITLE_TOKENS = new Set([
  'artifact',
  'brief',
  'completed',
  'completion',
  'deliverable',
  'draft',
  'file',
  'final',
  'handoff',
  'initial',
  'interim',
  'note',
  'output',
  'packet',
  'report',
  'result',
  'results',
  'summary',
  'updated',
]);

function isPathLikeVisibleTitle(
  deliverable: WorkflowDeliverableRecord,
  visibleTitle: string,
): boolean {
  const primaryTarget = asRecord(deliverable.primary_target);
  const targetPath = normalizeDeliverableTargetPath(readOptionalString(primaryTarget.path));
  if (!targetPath) {
    return visibleTitle.startsWith('artifact:');
  }
  return normalizeDeliverableTargetPath(visibleTitle) === targetPath;
}
