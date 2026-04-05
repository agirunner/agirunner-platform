import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseQueryable } from '../../db/database.js';
import type { UpsertWorkflowDeliverableInput, WorkflowDeliverableService } from '../workflow-deliverables/workflow-deliverable-service.js';
import { sanitizeLinkedIdList, sanitizeOptionalText } from './workflow-operator-record-sanitization.js';
import {
  buildArtifactPreviewCapabilities,
  buildArtifactTarget,
  buildBriefPreviewSummary,
  buildInlinePreviewCapabilities,
  buildInlineSummaryTarget,
  deriveDeliverableLifecycleFromBriefStatus,
  normalizeDeliverableLifecycleForBriefStatus,
  normalizeNullableText,
  readBriefHeadline,
  readBriefSummary,
  isWorkflowScopedOrchestratorBriefLinkedToChildScope,
  shouldMaterializeDeliverablePacket,
  toWorkflowOperatorBriefRecord,
} from './workflow-operator-brief-service.domain.js';
import {
  isInternalReferenceLinkedDeliverable,
  isPathOnlyPlaceholderLinkedDeliverable,
  normalizeLinkedDeliverablePrimaryTarget,
} from './workflow-operator-linked-deliverables.js';
import type {
  ArtifactRow,
  ExistingDescriptorRow,
  WorkflowOperatorBriefRow,
} from './workflow-operator-brief-service.types.js';
import type {
  WorkflowOperatorBriefPayloadInput,
  WorkflowOperatorBriefRecord,
} from './workflow-operator-brief-service.js';

export async function syncLinkedDeliverables(
  pool: DatabaseQueryable,
  deliverableService: Pick<WorkflowDeliverableService, 'upsertDeliverable'> | undefined,
  identity: ApiKeyIdentity,
  workflowId: string,
  briefRow: WorkflowOperatorBriefRow,
  payload: WorkflowOperatorBriefPayloadInput,
): Promise<WorkflowOperatorBriefRecord> {
  const existingIds = sanitizeLinkedIdList(briefRow.related_output_descriptor_ids);
  const linkedDescriptorIds = await materializeLinkedDeliverables(
    pool,
    deliverableService,
    identity,
    workflowId,
    briefRow,
    payload,
  );
  if (sameLinkedDescriptorIds(existingIds, linkedDescriptorIds)) {
    return toWorkflowOperatorBriefRecord(briefRow);
  }
  const result = await pool.query<WorkflowOperatorBriefRow>(
    `UPDATE workflow_operator_briefs
        SET related_output_descriptor_ids = $1::jsonb,
            related_artifact_ids = $2::jsonb,
            updated_at = now()
      WHERE tenant_id = $3
        AND workflow_id = $4
        AND id = $5
    RETURNING *`,
    [
      JSON.stringify(linkedDescriptorIds),
      JSON.stringify(sanitizeLinkedIdList(briefRow.related_artifact_ids)),
      identity.tenantId,
      workflowId,
      briefRow.id,
    ],
  );
  return toWorkflowOperatorBriefRecord(result.rows[0]);
}

async function materializeLinkedDeliverables(
  pool: DatabaseQueryable,
  deliverableService: Pick<WorkflowDeliverableService, 'upsertDeliverable'> | undefined,
  identity: ApiKeyIdentity,
  workflowId: string,
  briefRow: WorkflowOperatorBriefRow,
  payload: WorkflowOperatorBriefPayloadInput,
): Promise<string[]> {
  if (!deliverableService) {
    return [];
  }
  const existingIds = sanitizeLinkedIdList(briefRow.related_output_descriptor_ids);
  const rawExplicitDeliverables =
    Array.isArray(payload.linkedDeliverables) && payload.linkedDeliverables.length > 0
      ? payload.linkedDeliverables
      : [];
  const explicitDeliverables = rawExplicitDeliverables
    .map((deliverable) => normalizeLinkedDeliverablePrimaryTarget(deliverable))
    .filter((deliverable) => !isInternalReferenceLinkedDeliverable(deliverable))
    .filter((deliverable) => !isPathOnlyPlaceholderLinkedDeliverable(deliverable));
  const hasExplicitLinkedDeliverables = rawExplicitDeliverables.length > 0;
  const shouldSynthesizePacket = shouldMaterializeDeliverablePacket(briefRow);
  if (hasExplicitLinkedDeliverables && explicitDeliverables.length === 0) {
    return [];
  }
  if (explicitDeliverables.length === 0 && !shouldSynthesizePacket) {
    return existingIds;
  }
  if (explicitDeliverables.length === 0 && shouldSynthesizePacket) {
    const attributedWorkItemId = await resolveDeliverableWorkItemId(pool, identity.tenantId, workflowId, briefRow);
    const existingDescriptor = await loadExistingDescriptor(pool, identity.tenantId, workflowId, briefRow.id);
    if (
      existingDescriptor
      && normalizeNullableText(existingDescriptor.work_item_id) === normalizeNullableText(attributedWorkItemId)
    ) {
      return [existingDescriptor.id];
    }
  } else if (existingIds.length > 0) {
    return existingIds;
  }
  const synthesizedDeliverable =
    explicitDeliverables.length === 0
      ? await buildSynthesizedDeliverable(pool, identity.tenantId, workflowId, briefRow)
      : null;
  const deliverables = explicitDeliverables.length > 0
    ? explicitDeliverables
    : synthesizedDeliverable
      ? [synthesizedDeliverable]
      : [];
  if (deliverables.length === 0) {
    return [];
  }
  const descriptorIds: string[] = [];
  for (const deliverable of deliverables) {
    const record = await deliverableService.upsertDeliverable(identity, workflowId, {
      ...normalizeDeliverableLifecycleForBriefStatus(deliverable, briefRow.status_kind),
      sourceBriefId: briefRow.id,
    });
    descriptorIds.push(record.descriptor_id);
  }
  return descriptorIds;
}

function sameLinkedDescriptorIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

async function buildSynthesizedDeliverable(
  pool: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  briefRow: WorkflowOperatorBriefRow,
): Promise<UpsertWorkflowDeliverableInput | null> {
  const attributedWorkItemId = await resolveDeliverableWorkItemId(pool, tenantId, workflowId, briefRow);
  if (isWorkflowScopedOrchestratorBriefLinkedToChildScope(briefRow) && !attributedWorkItemId) {
    return null;
  }
  const [existingDescriptor, artifacts] = await Promise.all([
    loadExistingDescriptor(pool, tenantId, workflowId, briefRow.id),
    loadArtifacts(pool, tenantId, workflowId, sanitizeLinkedIdList(briefRow.related_artifact_ids)),
  ]);
  const artifactTargets = artifacts.map((artifact, index) => buildArtifactTarget(artifact, index === 0));
  const headline = readBriefHeadline(briefRow);
  const lifecycle = deriveDeliverableLifecycleFromBriefStatus(briefRow.status_kind);
  return {
    descriptorId:
      existingDescriptor
      && normalizeNullableText(existingDescriptor.work_item_id) === normalizeNullableText(attributedWorkItemId)
        ? existingDescriptor.id
        : undefined,
    workItemId: attributedWorkItemId,
    descriptorKind: 'brief_packet',
    deliveryStage: lifecycle.deliveryStage,
    title: headline,
    state: lifecycle.state,
    summaryBrief: readBriefSummary(briefRow),
    previewCapabilities: artifacts.length > 0
      ? buildArtifactPreviewCapabilities(artifacts[0])
      : buildInlinePreviewCapabilities(),
    primaryTarget: artifactTargets[0] ?? buildInlineSummaryTarget(),
    secondaryTargets: artifactTargets.slice(1),
    contentPreview: {
      summary: buildBriefPreviewSummary(briefRow),
    },
    sourceBriefId: briefRow.id,
  };
}

async function loadExistingDescriptor(
  pool: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  sourceBriefId: string,
): Promise<ExistingDescriptorRow | null> {
  const result = await pool.query<ExistingDescriptorRow>(
    `SELECT id, work_item_id
       FROM workflow_output_descriptors
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND source_brief_id = $3
      LIMIT 1`,
    [tenantId, workflowId, sourceBriefId],
  );
  return result.rows[0] ?? null;
}

async function loadArtifacts(
  pool: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  artifactIds: string[],
): Promise<ArtifactRow[]> {
  if (artifactIds.length === 0) {
    return [];
  }
  const result = await pool.query<ArtifactRow>(
    `SELECT id, task_id, logical_path, content_type, size_bytes
       FROM workflow_artifacts
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = ANY($3::uuid[])
      ORDER BY created_at ASC`,
    [tenantId, workflowId, artifactIds],
  );
  const order = new Map(artifactIds.map((artifactId, index) => [artifactId, index]));
  return [...result.rows].sort(
    (left, right) =>
      (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

async function resolveDeliverableWorkItemId(
  pool: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  briefRow: WorkflowOperatorBriefRow,
): Promise<string | undefined> {
  const directWorkItemId = sanitizeOptionalText(briefRow.work_item_id);
  if (directWorkItemId) {
    return directWorkItemId;
  }

  const linkedTargetIds = sanitizeLinkedIdList(briefRow.linked_target_ids).filter(
    (targetId) => targetId !== briefRow.workflow_id,
  );
  if (linkedTargetIds.length === 0) {
    return undefined;
  }

  const directTargets = await pool.query<{ id: string }>(
    `SELECT id
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id::text = ANY($3::text[])
      LIMIT 2`,
    [tenantId, workflowId, linkedTargetIds],
  );
  if (directTargets.rowCount === 1) {
    return directTargets.rows[0]?.id;
  }

  const taskTargets = await pool.query<{ work_item_id: string }>(
    `SELECT DISTINCT work_item_id
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id::text = ANY($3::text[])
        AND work_item_id IS NOT NULL
      LIMIT 2`,
    [tenantId, workflowId, linkedTargetIds],
  );
  if (taskTargets.rowCount === 1) {
    return sanitizeOptionalText(taskTargets.rows[0]?.work_item_id) ?? undefined;
  }

  return undefined;
}
