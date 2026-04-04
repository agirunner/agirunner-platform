import { createHash } from 'node:crypto';

import type { MissionControlOutputDescriptor } from '../mission-control/types.js';
import type { WorkflowDeliverableRecord } from '../../workflow-deliverables/workflow-deliverable-service.js';
import type { WorkflowWorkspacePacket } from '../workflow-operations-types.js';
import type { WorkspaceDeliverablesPacket } from './workflow-workspace-types.js';
import {
  asRecord,
  isBlockedGateStatus,
  readOptionalString,
} from './workflow-workspace-common.js';
import { normalizeDeliverableTargetPath } from '../workflow-deliverables-service/shared.js';

export function buildWorkspaceDeliverablesPacket(
  deliverables: WorkspaceDeliverablesPacket,
  outputDescriptors: MissionControlOutputDescriptor[],
  workflowId: string,
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
  board: Record<string, unknown>,
): WorkspaceDeliverablesPacket {
  const scopedDeliverables = filterWorkspaceDeliverablesForSelectedScope(deliverables, selectedScope);
  const visibleDeliverables = [
    ...scopedDeliverables.final_deliverables,
    ...scopedDeliverables.in_progress_deliverables,
  ];
  const fallbackDeliverables = buildFallbackOutputDescriptorDeliverables(
    outputDescriptors,
    workflowId,
    selectedScope,
    board,
  );
  const mergedVisibleDeliverables = mergeVisibleDeliverablesWithFallbacks(
    visibleDeliverables,
    fallbackDeliverables,
  );
  const consumedIdentityKeys = new Set(
    mergedVisibleDeliverables
      .map(readDeliverableIdentityKey)
      .filter((key): key is string => key !== null),
  );
  const remainingFallbackDeliverables = fallbackDeliverables.filter((deliverable) => {
    const identityKey = readDeliverableIdentityKey(deliverable);
    return identityKey === null || !consumedIdentityKeys.has(identityKey);
  });
  const mergedFinalDeliverables = [
    ...mergedVisibleDeliverables.filter(isFinalWorkspaceDeliverable),
    ...remainingFallbackDeliverables.filter(isFinalWorkspaceDeliverable),
  ];
  const mergedInProgressDeliverables = [
    ...mergedVisibleDeliverables.filter((deliverable) => !isFinalWorkspaceDeliverable(deliverable)),
    ...remainingFallbackDeliverables.filter((deliverable) => !isFinalWorkspaceDeliverable(deliverable)),
  ];
  const presentedDeliverables = normalizeWorkflowScopeRollupDeliverables(
    mergedFinalDeliverables,
    mergedInProgressDeliverables,
    selectedScope,
    board,
  );

  return {
    ...scopedDeliverables,
    final_deliverables: presentedDeliverables.final_deliverables,
    in_progress_deliverables: presentedDeliverables.in_progress_deliverables,
    all_deliverables: [
      ...presentedDeliverables.final_deliverables,
      ...presentedDeliverables.in_progress_deliverables,
    ],
  };
}

export function normalizeWorkspaceDeliverablesPacket(
  deliverables: WorkflowWorkspacePacket['deliverables'],
): WorkspaceDeliverablesPacket {
  return {
    ...deliverables,
    final_deliverables: deliverables.final_deliverables as WorkflowDeliverableRecord[],
    in_progress_deliverables: deliverables.in_progress_deliverables as WorkflowDeliverableRecord[],
    all_deliverables: (deliverables as WorkspaceDeliverablesPacket).all_deliverables,
  };
}

function buildFallbackOutputDescriptorDeliverables(
  outputDescriptors: MissionControlOutputDescriptor[],
  workflowId: string,
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
  board: Record<string, unknown>,
): WorkflowDeliverableRecord[] {
  const blockedWorkItemIds = readBlockedWorkItemIds(board);
  const incompleteWorkItemIds = readIncompleteWorkItemIds(board);
  const fallbackDeliverables: WorkflowDeliverableRecord[] = [];
  const emittedKeys = new Set<string>();

  for (const descriptor of selectScopedOutputDescriptors(outputDescriptors, selectedScope)) {
    if (descriptor.workItemId && blockedWorkItemIds.has(descriptor.workItemId)) {
      continue;
    }
    const fallbackDeliverable = normalizeFallbackOutputDescriptorDeliverable(
      composeFallbackDeliverableFromOutputDescriptor(workflowId, descriptor),
      incompleteWorkItemIds,
    );
    const identityKey = readDeliverableIdentityKey(fallbackDeliverable);
    if (!identityKey || emittedKeys.has(identityKey)) {
      continue;
    }
    fallbackDeliverables.push(fallbackDeliverable);
    emittedKeys.add(identityKey);
  }

  return fallbackDeliverables;
}

function filterWorkspaceDeliverablesForSelectedScope(
  deliverables: WorkspaceDeliverablesPacket,
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): WorkspaceDeliverablesPacket {
  if (selectedScope.scope_kind !== 'selected_work_item' && selectedScope.scope_kind !== 'selected_task') {
    return deliverables;
  }
  const selectedWorkItemId = selectedScope.work_item_id;
  if (!selectedWorkItemId) {
    return {
      ...deliverables,
      final_deliverables: [],
      in_progress_deliverables: [],
      all_deliverables: [],
    };
  }
  const matchesSelectedWorkItem = (deliverable: WorkflowDeliverableRecord): boolean =>
    deliverable.work_item_id === selectedWorkItemId;
  return {
    ...deliverables,
    final_deliverables: deliverables.final_deliverables.filter(matchesSelectedWorkItem),
    in_progress_deliverables: deliverables.in_progress_deliverables.filter(matchesSelectedWorkItem),
    all_deliverables: (deliverables.all_deliverables ?? []).filter(matchesSelectedWorkItem),
  };
}

function selectScopedOutputDescriptors(
  outputDescriptors: MissionControlOutputDescriptor[],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): MissionControlOutputDescriptor[] {
  if (selectedScope.scope_kind === 'workflow') {
    return outputDescriptors;
  }
  if (!selectedScope.work_item_id) {
    return [];
  }
  return outputDescriptors.filter(
    (descriptor) => descriptor.workItemId === selectedScope.work_item_id,
  );
}

function readBlockedWorkItemIds(board: Record<string, unknown>): Set<string> {
  const blockedIds = new Set<string>();
  const workItems = Array.isArray(board.work_items) ? board.work_items : [];
  for (const workItem of workItems) {
    const record = asRecord(workItem);
    const workItemId = readOptionalString(record.id);
    if (!workItemId) {
      continue;
    }
    const blockedState = readOptionalString(record.blocked_state);
    const gateStatus = readOptionalString(record.gate_status);
    if (blockedState === 'blocked' || isBlockedGateStatus(gateStatus)) {
      blockedIds.add(workItemId);
    }
  }
  return blockedIds;
}

function readIncompleteWorkItemIds(board: Record<string, unknown>): Set<string> {
  const incompleteIds = new Set<string>();
  const columnTerminality = new Map<string, boolean>();
  const columns = Array.isArray(board.columns) ? board.columns : [];
  for (const column of columns) {
    const record = asRecord(column);
    const columnId = readOptionalString(record.id);
    if (!columnId) {
      continue;
    }
    columnTerminality.set(columnId, record.is_terminal === true);
  }

  const workItems = Array.isArray(board.work_items) ? board.work_items : [];
  for (const workItem of workItems) {
    const record = asRecord(workItem);
    const workItemId = readOptionalString(record.id);
    if (!workItemId) {
      continue;
    }
    const columnId = readOptionalString(record.column_id);
    const isTerminalColumn = columnId ? columnTerminality.get(columnId) === true : false;
    if (!isTerminalColumn || !hasCompletedWorkItemMarker(record)) {
      incompleteIds.add(workItemId);
    }
  }
  return incompleteIds;
}

function hasCompletedWorkItemMarker(record: Record<string, unknown>): boolean {
  return record.completed_at != null;
}

function composeFallbackDeliverableFromOutputDescriptor(
  workflowId: string,
  descriptor: MissionControlOutputDescriptor,
): WorkflowDeliverableRecord {
  const contentPreview: Record<string, unknown> = {};
  if (descriptor.summary) {
    contentPreview.summary = descriptor.summary;
  }
  if (descriptor.producedByRole) {
    contentPreview.source_role_name = descriptor.producedByRole;
  }

  return {
    descriptor_id: buildFallbackOutputDescriptorId(descriptor),
    workflow_id: workflowId,
    work_item_id: descriptor.workItemId,
    descriptor_kind: descriptor.primaryLocation.kind,
    delivery_stage: isFinalOutputDescriptorStatus(descriptor.status) ? 'final' : 'in_progress',
    title: descriptor.title,
    state: descriptor.status,
    summary_brief: descriptor.summary,
    preview_capabilities: {},
    primary_target: composeFallbackPrimaryTarget(descriptor),
    secondary_targets: [],
    content_preview: contentPreview,
    source_brief_id: null,
    created_at: '',
    updated_at: '',
  };
}

function normalizeFallbackOutputDescriptorDeliverable(
  deliverable: WorkflowDeliverableRecord,
  incompleteWorkItemIds: Set<string>,
): WorkflowDeliverableRecord {
  const workItemId = readOptionalString(deliverable.work_item_id);
  if (!workItemId || !incompleteWorkItemIds.has(workItemId) || !isFinalWorkspaceDeliverable(deliverable)) {
    return deliverable;
  }
  return {
    ...deliverable,
    delivery_stage: 'in_progress',
    state: deliverable.state === 'final' ? 'approved' : deliverable.state,
  };
}

function buildFallbackOutputDescriptorId(descriptor: MissionControlOutputDescriptor): string {
  const descriptorId = readOptionalString(descriptor.id);
  if (descriptorId) {
    return `output:${descriptorId}`;
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      title: descriptor.title,
      summary: descriptor.summary,
      status: descriptor.status,
      producedByRole: descriptor.producedByRole,
      workItemId: descriptor.workItemId,
      taskId: descriptor.taskId,
      stageName: descriptor.stageName,
      primaryLocation: descriptor.primaryLocation,
      secondaryLocations: descriptor.secondaryLocations,
    }))
    .digest('hex')
    .slice(0, 16);
  return `output:derived:${fingerprint}`;
}

function composeFallbackPrimaryTarget(
  descriptor: MissionControlOutputDescriptor,
): Record<string, unknown> {
  const location = descriptor.primaryLocation;
  switch (location.kind) {
    case 'artifact':
      return {
        target_kind: 'artifact',
        label: 'Open artifact',
        url: normalizeArtifactPreviewUrl(location.previewPath, location.taskId, location.artifactId),
        path: location.logicalPath,
        artifact_id: location.artifactId,
        size_bytes: location.sizeBytes,
      };
    case 'repository':
      return {
        target_kind: 'repository',
        label: 'Open repository output',
        url: location.pullRequestUrl ?? location.branchUrl ?? location.commitUrl ?? location.repository,
        repo_ref: location.branch ?? location.commitSha ?? location.repository,
      };
    case 'workflow_document':
      return {
        target_kind: 'workflow_document',
        label: 'Open workflow document',
        url: location.location,
        path: location.logicalName,
        artifact_id: location.artifactId,
      };
    case 'external_url':
      return {
        target_kind: 'external_url',
        label: 'Open link',
        url: location.url,
      };
    case 'host_directory':
      return {
        target_kind: 'host_directory',
        label: 'Open host directory',
        path: location.path,
      };
  }
}

function normalizeArtifactPreviewUrl(
  previewPath: string | null,
  taskId: string,
  artifactId: string,
): string {
  const normalizedPreviewPath = readOptionalString(previewPath);
  if (!normalizedPreviewPath) {
    return `/api/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/preview`;
  }
  const deprecatedMatch = normalizedPreviewPath.match(/^\/artifacts\/tasks\/([^/]+)\/([^/?#]+)$/);
  if (!deprecatedMatch) {
    return normalizedPreviewPath;
  }
  return `/api/v1/tasks/${encodeURIComponent(deprecatedMatch[1])}/artifacts/${encodeURIComponent(deprecatedMatch[2])}/preview`;
}

function isFinalWorkspaceDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  return deliverable.delivery_stage === 'final' || deliverable.state === 'final';
}

function isFinalOutputDescriptorStatus(status: MissionControlOutputDescriptor['status']): boolean {
  return status === 'approved' || status === 'final';
}

function normalizeWorkflowScopeRollupDeliverables(
  finalDeliverables: WorkflowDeliverableRecord[],
  inProgressDeliverables: WorkflowDeliverableRecord[],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
  board: Record<string, unknown>,
): {
  final_deliverables: WorkflowDeliverableRecord[];
  in_progress_deliverables: WorkflowDeliverableRecord[];
} {
  const incompleteWorkItemIds = readIncompleteWorkItemIds(board);
  if (selectedScope.scope_kind !== 'workflow' || incompleteWorkItemIds.size === 0) {
    return {
      final_deliverables: finalDeliverables,
      in_progress_deliverables: inProgressDeliverables,
    };
  }

  const stableFinalDeliverables = finalDeliverables.filter(
    (deliverable) => !shouldDowngradeWorkflowRollupDeliverable(deliverable, incompleteWorkItemIds),
  );
  const reclassifiedDeliverables = finalDeliverables
    .filter((deliverable) =>
      shouldDowngradeWorkflowRollupDeliverable(deliverable, incompleteWorkItemIds),
    )
    .map(downgradeFinalDeliverableForActiveWorkflow);

  return {
    final_deliverables: stableFinalDeliverables,
    in_progress_deliverables: [
      ...reclassifiedDeliverables,
      ...inProgressDeliverables,
    ],
  };
}

function downgradeFinalDeliverableForActiveWorkflow(
  deliverable: WorkflowDeliverableRecord,
): WorkflowDeliverableRecord {
  return {
    ...deliverable,
    delivery_stage: 'in_progress',
    state: deliverable.state === 'final' ? 'approved' : deliverable.state,
  };
}

function shouldDowngradeWorkflowRollupDeliverable(
  deliverable: WorkflowDeliverableRecord,
  incompleteWorkItemIds: Set<string>,
): boolean {
  const sourceWorkItemId = readOptionalString(
    asRecord(deliverable.content_preview).rollup_source_work_item_id,
  );
  return sourceWorkItemId !== null && incompleteWorkItemIds.has(sourceWorkItemId);
}

function mergeVisibleDeliverablesWithFallbacks(
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
      return deliverable;
    }
    const fallback = fallbackByIdentity.get(identityKey);
    if (!fallback) {
      return deliverable;
    }
    if (shouldOverlayVisibleDeliverable(deliverable, fallback)) {
      return overlayVisibleDeliverableWithFallback(deliverable, fallback);
    }
    return mergeVisibleDeliverableMetadata(deliverable, fallback);
  });
}

function shouldOverlayVisibleDeliverable(
  visibleDeliverable: WorkflowDeliverableRecord,
  fallbackDeliverable: WorkflowDeliverableRecord,
): boolean {
  return isInlineSummaryPlaceholderDeliverable(visibleDeliverable)
    && hasConcreteContentTarget(fallbackDeliverable);
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

function isInlineSummaryPlaceholderDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  const primaryTarget = asRecord(deliverable.primary_target);
  return readOptionalString(primaryTarget.target_kind) === 'inline_summary'
    && readOptionalString(primaryTarget.path) !== null;
}

function hasConcreteContentTarget(deliverable: WorkflowDeliverableRecord): boolean {
  const primaryTarget = asRecord(deliverable.primary_target);
  return readOptionalString(primaryTarget.target_kind) !== 'inline_summary'
    || readOptionalString(primaryTarget.artifact_id) !== null
    || readOptionalString(primaryTarget.url) !== null
    || readOptionalString(primaryTarget.repo_ref) !== null;
}

function readDeliverableIdentityKey(deliverable: WorkflowDeliverableRecord): string | null {
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
