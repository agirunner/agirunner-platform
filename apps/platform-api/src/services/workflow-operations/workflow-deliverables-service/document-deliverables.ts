import type { WorkflowDeliverableRecord } from '../../workflow-deliverables/workflow-deliverable-service.js';
import type { ResolvedDocumentReference } from '../../document-reference/document-reference-service.js';

import {
  isPacketLikeDeliverable,
  readDeliverableTargetIdentityKey,
  readRollupSourceDescriptorId,
  readRollupSourceWorkItemId,
} from './shared.js';
import { readOptionalString } from '../workflow-workspace/workflow-workspace-common.js';

export function appendSynthesizedWorkflowDocumentDeliverables(
  deliverables: WorkflowDeliverableRecord[],
  documents: ResolvedDocumentReference[],
  workflowId: string,
): WorkflowDeliverableRecord[] {
  if (documents.length === 0) {
    return deliverables;
  }

  const records = [...deliverables];
  const existingIds = new Set(records.map((deliverable) => deliverable.descriptor_id));
  const existingNonPacketTargetKeys = new Set(
    records
      .filter((deliverable) => !isPacketLikeDeliverable(deliverable))
      .map(readDeliverableTargetIdentityKey)
      .filter((key): key is string => key !== null),
  );

  for (const document of documents) {
    const syntheticDeliverable = buildWorkflowDocumentDeliverable(document, workflowId);
    if (!syntheticDeliverable) {
      continue;
    }
    if (existingIds.has(syntheticDeliverable.descriptor_id)) {
      continue;
    }
    const identityKey = readDeliverableTargetIdentityKey(syntheticDeliverable);
    if (identityKey && existingNonPacketTargetKeys.has(identityKey)) {
      continue;
    }
    records.push(syntheticDeliverable);
    existingIds.add(syntheticDeliverable.descriptor_id);
    if (identityKey) {
      existingNonPacketTargetKeys.add(identityKey);
    }
  }

  return records;
}

export function suppressMirroredWorkflowRollupDuplicates(
  deliverables: WorkflowDeliverableRecord[],
  selectedWorkItemId?: string,
): WorkflowDeliverableRecord[] {
  if (!selectedWorkItemId) {
    return deliverables;
  }
  const workflowRollupSources = new Set(
    deliverables
      .filter((deliverable) => readOptionalString(deliverable.work_item_id) === null)
      .map(readRollupSourceDescriptorId)
      .filter((descriptorId): descriptorId is string => descriptorId !== null),
  );
  return deliverables.filter((deliverable) => {
    const workItemId = readOptionalString(deliverable.work_item_id);
    if (workItemId !== null) {
      return true;
    }
    return (
      readRollupSourceWorkItemId(deliverable) === null
      || readRollupSourceWorkItemId(deliverable) === selectedWorkItemId
      || !workflowRollupSources.has(deliverable.descriptor_id)
    );
  });
}

export function normalizeDeliverableTargets(
  deliverable: WorkflowDeliverableRecord,
): WorkflowDeliverableRecord {
  return {
    ...deliverable,
    primary_target: normalizeDeliverableTarget(asTargetRecord(deliverable.primary_target)),
    secondary_targets: normalizeDeliverableTargetList(deliverable.secondary_targets),
  };
}

export function buildWorkflowDocumentDeliverable(
  document: ResolvedDocumentReference,
  workflowId: string,
): WorkflowDeliverableRecord | null {
  if (document.scope !== 'workflow') {
    return null;
  }

  const title = readOptionalString(document.title) ?? document.logical_name;
  const summary = readOptionalString(document.description);
  const previewSummary = buildWorkflowDocumentPreviewSummary(document);
  const primaryTarget = buildWorkflowDocumentTarget(document, title);

  return {
    descriptor_id: `workflow-document:${document.logical_name}`,
    workflow_id: workflowId,
    work_item_id: null,
    descriptor_kind: 'workflow_document',
    delivery_stage: 'final',
    title,
    state: 'final',
    summary_brief: summary,
    preview_capabilities: buildWorkflowDocumentPreviewCapabilities(document),
    primary_target: primaryTarget,
    secondary_targets: [],
    content_preview: {
      summary: previewSummary,
    },
    source_brief_id: null,
    created_at: document.created_at ?? new Date(0).toISOString(),
    updated_at: document.created_at ?? new Date(0).toISOString(),
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

function serializeNormalizedUrl(parsed: URL): string {
  return parsed.origin === 'http://dashboard.local'
    ? `${parsed.pathname}${parsed.search}${parsed.hash}`
    : parsed.toString();
}

function buildWorkflowDocumentPreviewSummary(document: ResolvedDocumentReference): string {
  const lines = [
    readOptionalString(document.description),
    document.source === 'repository'
      ? [
          readOptionalString(document.repository),
          readOptionalString(document.path),
        ]
          .filter((entry): entry is string => entry !== null)
          .join(' • ')
      : null,
    document.source === 'external' ? readOptionalString(document.url) : null,
    document.source === 'artifact' ? readOptionalString(document.artifact?.logical_path) : null,
  ].filter((entry): entry is string => entry !== null);

  return lines.join('\n\n');
}

function buildWorkflowDocumentPreviewCapabilities(
  document: ResolvedDocumentReference,
): Record<string, unknown> {
  if (document.source === 'artifact') {
    const contentType = readOptionalString(document.artifact?.content_type) ?? '';
    return {
      can_inline_preview: true,
      can_download: true,
      can_open_external: false,
      can_copy_path: Boolean(readOptionalString(document.artifact?.logical_path)),
      preview_kind: contentType.includes('markdown')
        ? 'markdown'
        : contentType.includes('json')
          ? 'json'
          : 'text',
    };
  }

  return {
    can_inline_preview: false,
    can_download: false,
    can_open_external: false,
    can_copy_path: Boolean(readOptionalString(document.path)),
    preview_kind: 'structured_summary',
  };
}

function buildWorkflowDocumentTarget(
  document: ResolvedDocumentReference,
  title: string,
): Record<string, unknown> {
  if (document.source === 'artifact' && document.artifact) {
    return {
      target_kind: 'artifact',
      label: title,
      url: `/api/v1/tasks/${encodeURIComponent(document.artifact.task_id)}/artifacts/${encodeURIComponent(document.artifact.id)}/preview`,
      path: readOptionalString(document.artifact.logical_path),
      artifact_id: document.artifact.id,
    };
  }

  if (document.source === 'external') {
    return {
      target_kind: 'external',
      label: title,
      url: readOptionalString(document.url) ?? '',
    };
  }

  return {
    target_kind: 'repo_reference',
    label: title,
    url: '',
    repo_ref: [readOptionalString(document.repository), readOptionalString(document.path)]
      .filter((entry): entry is string => entry !== null)
      .join(':'),
    path: readOptionalString(document.path),
  };
}
