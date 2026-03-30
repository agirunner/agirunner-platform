import { randomUUID } from 'node:crypto';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseQueryable } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { resolveOperatorRecordActorId } from './operator-record-authorship.js';
import {
  resolveWorkflowOperatorExecutionContext,
  type ResolvedWorkflowOperatorExecutionContext,
  type WorkflowOperatorExecutionContextInput,
} from './workflow-operator-execution-context.js';
import type { UpsertWorkflowDeliverableInput, WorkflowDeliverableService } from './workflow-deliverable-service.js';
import {
  sanitizeLinkedIdList,
  sanitizeOperatorDetailedBrief,
  sanitizeOperatorShortBrief,
  sanitizeOptionalText,
} from './workflow-operator-record-sanitization.js';

interface ArtifactRow {
  id: string;
  task_id: string;
  logical_path: string | null;
  content_type: string | null;
  size_bytes: number | null;
}

interface ExistingDescriptorRow {
  id: string;
  work_item_id: string | null;
}

interface WorkflowOperatorBriefRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string | null;
  request_id: string;
  execution_context_id: string;
  brief_kind: string;
  brief_scope: string;
  source_kind: string;
  source_role_name: string | null;
  llm_turn_count: number | null;
  status_kind: string;
  short_brief: Record<string, unknown>;
  detailed_brief_json: Record<string, unknown>;
  linked_target_ids: string[] | null;
  sequence_number: number;
  related_artifact_ids: string[] | null;
  related_output_descriptor_ids: string[] | null;
  related_intervention_ids: string[] | null;
  canonical_workflow_brief_id: string | null;
  created_by_type: string;
  created_by_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface WorkflowOperatorBriefRecord {
  id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string | null;
  request_id: string;
  execution_context_id: string;
  brief_kind: string;
  brief_scope: string;
  source_kind: string;
  source_role_name: string | null;
  llm_turn_count: number | null;
  status_kind: string;
  short_brief: Record<string, unknown>;
  detailed_brief_json: Record<string, unknown>;
  linked_target_ids: string[];
  sequence_number: number;
  related_artifact_ids: string[];
  related_output_descriptor_ids: string[];
  related_intervention_ids: string[];
  canonical_workflow_brief_id: string | null;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowOperatorBriefPayloadInput {
  shortBrief: Record<string, unknown>;
  detailedBriefJson: Record<string, unknown>;
  linkedDeliverables?: UpsertWorkflowDeliverableInput[];
  linkedTargetIds?: unknown;
}

export interface RecordWorkflowOperatorBriefInput {
  requestId?: string;
  executionContextId: string;
  workItemId?: string;
  taskId?: string;
  llmTurnCount?: number;
  briefKind?: string;
  briefScope?: string;
  sourceKind?: string;
  sourceRoleName?: string;
  statusKind?: string;
  payload: WorkflowOperatorBriefPayloadInput;
  relatedArtifactIds?: unknown;
  relatedInterventionIds?: unknown;
  canonicalWorkflowBriefId?: string;
}

export interface ListWorkflowOperatorBriefsInput {
  workItemId?: string;
  taskId?: string;
  includeWorkflowScope?: boolean;
  includeAllWorkItemScopes?: boolean;
  limit?: number;
  unbounded?: boolean;
}

export interface WorkflowOperatorBriefWriteResult {
  record_id: string;
  sequence_number: number;
  deduped: boolean;
  record: WorkflowOperatorBriefRecord;
}

export class WorkflowOperatorBriefService {
  constructor(
    private readonly pool: DatabaseQueryable,
    private readonly deliverableService?: Pick<WorkflowDeliverableService, 'upsertDeliverable'>,
  ) {}

  async listBriefs(
    tenantId: string,
    workflowId: string,
    input: ListWorkflowOperatorBriefsInput = {},
  ): Promise<WorkflowOperatorBriefRecord[]> {
    await this.assertWorkflow(tenantId, workflowId);
    const shouldApplyLimit = input.unbounded !== true;
    if (input.includeAllWorkItemScopes === true && !input.workItemId && !input.taskId) {
      const result = await this.pool.query<WorkflowOperatorBriefRow>(
        `SELECT *
           FROM workflow_operator_briefs
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY sequence_number DESC
          ${shouldApplyLimit ? 'LIMIT $3' : ''}`,
        shouldApplyLimit
          ? [
            tenantId,
            workflowId,
            input.limit ?? 50,
          ]
          : [
            tenantId,
            workflowId,
          ],
      );
      return result.rows.map(toWorkflowOperatorBriefRecord);
    }
    const result = await this.pool.query<WorkflowOperatorBriefRow>(
      `SELECT *
         FROM workflow_operator_briefs
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND (
            ($3::uuid IS NULL AND $5::uuid IS NULL)
            OR (
              $3::uuid IS NOT NULL
              AND (
                work_item_id = $3
                OR linked_target_ids @> jsonb_build_array($4::text)
                OR ($7::boolean = true AND work_item_id IS NULL)
              )
            )
            OR (
              $5::uuid IS NOT NULL
              AND (
                task_id = $5
                OR linked_target_ids @> jsonb_build_array($6::text)
              )
            )
          )
        ORDER BY sequence_number DESC
        ${shouldApplyLimit ? 'LIMIT $8' : ''}`,
      shouldApplyLimit
        ? [
          tenantId,
          workflowId,
          input.workItemId ?? null,
          input.workItemId ?? null,
          input.taskId ?? null,
          input.taskId ?? null,
          input.includeWorkflowScope === true,
          input.limit ?? 50,
        ]
        : [
          tenantId,
          workflowId,
          input.workItemId ?? null,
          input.workItemId ?? null,
          input.taskId ?? null,
          input.taskId ?? null,
          input.includeWorkflowScope === true,
        ],
    );
    return result.rows.map(toWorkflowOperatorBriefRecord);
  }

  async recordBrief(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: RecordWorkflowOperatorBriefInput,
  ): Promise<WorkflowOperatorBriefRecord> {
    const result = await this.recordBriefWrite(identity, workflowId, input);
    return result.record;
  }

  async recordBriefWrite(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: RecordWorkflowOperatorBriefInput,
  ): Promise<WorkflowOperatorBriefWriteResult> {
    await this.assertWorkflow(identity.tenantId, workflowId);
    const executionContext = await this.resolveExecutionContext(identity, workflowId, input);
    const effectiveRequestId = sanitizeOptionalText(input.requestId) ?? randomUUID();
    if (executionContext.workItemId) {
      await this.assertWorkItem(identity.tenantId, workflowId, executionContext.workItemId);
    }
    const effectiveStatusKind = resolveEffectiveStatusKind(
      input.statusKind,
      input.payload.detailedBriefJson,
      sanitizeOptionalText(input.briefScope) ?? deriveDefaultBriefScope(executionContext, input.payload, null),
    );
    const effectiveBriefScope =
      sanitizeOptionalText(input.briefScope)
      ?? deriveDefaultBriefScope(executionContext, input.payload, effectiveStatusKind);
    const existing = await this.findByRequestId(identity.tenantId, workflowId, effectiveRequestId);
    if (existing) {
      const record = await this.syncLinkedDeliverables(identity, workflowId, existing, {
        ...input.payload,
        detailedBriefJson: withDefaultStatusKind(input.payload.detailedBriefJson, effectiveStatusKind),
      });
      return {
        record_id: record.id,
        sequence_number: record.sequence_number,
        deduped: true,
        record,
      };
    }

    const sequenceNumber = await this.nextSequenceNumber(identity.tenantId, workflowId);
    const shortBrief = sanitizeOperatorShortBrief(input.payload.shortBrief);
    const effectiveBriefKind = sanitizeOptionalText(input.briefKind) ?? 'milestone';
    const detailedBriefJson = sanitizeOperatorDetailedBrief(
      withDefaultStatusKind(input.payload.detailedBriefJson, effectiveStatusKind),
    );
    const linkedTargetIds = sanitizeLinkedIdList(input.payload.linkedTargetIds);
    const inserted = await this.pool.query<WorkflowOperatorBriefRow>(
      `INSERT INTO workflow_operator_briefs
         (id, tenant_id, workflow_id, work_item_id, task_id, request_id, execution_context_id, brief_kind, brief_scope, source_kind, short_brief, detailed_brief_json, status_kind, linked_target_ids, related_artifact_ids, related_output_descriptor_ids, related_intervention_ids, source_role_name, llm_turn_count, sequence_number, canonical_workflow_brief_id, created_by_type, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [
        randomUUID(),
        identity.tenantId,
        workflowId,
        executionContext.workItemId,
        executionContext.taskId,
        effectiveRequestId,
        executionContext.executionContextId,
        effectiveBriefKind,
        effectiveBriefScope,
        executionContext.sourceKind,
        serializeJsonb(shortBrief),
        serializeJsonb(detailedBriefJson),
        effectiveStatusKind,
        serializeJsonb(linkedTargetIds),
        serializeJsonb(sanitizeLinkedIdList(input.relatedArtifactIds)),
        serializeJsonb([]),
        serializeJsonb(sanitizeLinkedIdList(input.relatedInterventionIds)),
        executionContext.sourceRoleName,
        sanitizeOptionalPositiveInteger(input.llmTurnCount),
        sequenceNumber,
        sanitizeOptionalText(input.canonicalWorkflowBriefId),
        identity.ownerType,
        resolveOperatorRecordActorId(identity),
      ],
    );
    const syncedRecord = await this.syncLinkedDeliverables(identity, workflowId, inserted.rows[0], input.payload);
    return {
      record_id: syncedRecord.id,
      sequence_number: syncedRecord.sequence_number,
      deduped: false,
      record: syncedRecord,
    };
  }

  private async resolveExecutionContext(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: RecordWorkflowOperatorBriefInput,
  ): Promise<ResolvedWorkflowOperatorExecutionContext> {
    return resolveWorkflowOperatorExecutionContext(this.pool, identity, workflowId, {
      executionContextId: input.executionContextId,
      sourceKind: input.sourceKind,
      sourceRoleName: input.sourceRoleName,
      workItemId: input.workItemId,
      taskId: input.taskId,
    });
  }

  private async syncLinkedDeliverables(
    identity: ApiKeyIdentity,
    workflowId: string,
    briefRow: WorkflowOperatorBriefRow,
    payload: WorkflowOperatorBriefPayloadInput,
  ): Promise<WorkflowOperatorBriefRecord> {
    const linkedDescriptorIds = await this.materializeLinkedDeliverables(identity, workflowId, briefRow, payload);
    if (linkedDescriptorIds.length === 0) {
      return toWorkflowOperatorBriefRecord(briefRow);
    }
    const result = await this.pool.query<WorkflowOperatorBriefRow>(
      `UPDATE workflow_operator_briefs
          SET related_output_descriptor_ids = $1::jsonb,
              related_artifact_ids = $2::jsonb,
              updated_at = now()
        WHERE tenant_id = $3
          AND workflow_id = $4
          AND id = $5
      RETURNING *`,
      [
        serializeJsonb(linkedDescriptorIds),
        serializeJsonb(sanitizeLinkedIdList(briefRow.related_artifact_ids)),
        identity.tenantId,
        workflowId,
        briefRow.id,
      ],
    );
    return toWorkflowOperatorBriefRecord(result.rows[0]);
  }

  private async materializeLinkedDeliverables(
    identity: ApiKeyIdentity,
    workflowId: string,
    briefRow: WorkflowOperatorBriefRow,
    payload: WorkflowOperatorBriefPayloadInput,
  ): Promise<string[]> {
    if (!this.deliverableService) {
      return [];
    }
    const existingIds = sanitizeLinkedIdList(briefRow.related_output_descriptor_ids);
    const explicitDeliverables =
      Array.isArray(payload.linkedDeliverables) && payload.linkedDeliverables.length > 0
        ? payload.linkedDeliverables
        : [];
    const shouldSynthesizePacket = shouldMaterializeDeliverablePacket(briefRow);
    if (explicitDeliverables.length === 0 && !shouldSynthesizePacket) {
      return existingIds;
    }
    if (explicitDeliverables.length === 0 && shouldSynthesizePacket) {
      const attributedWorkItemId = await this.resolveDeliverableWorkItemId(
        identity.tenantId,
        workflowId,
        briefRow,
      );
      const existingDescriptor = await this.loadExistingDescriptor(identity.tenantId, workflowId, briefRow.id);
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
        ? await this.buildSynthesizedDeliverable(identity.tenantId, workflowId, briefRow)
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
      const record = await this.deliverableService.upsertDeliverable(identity, workflowId, {
        ...deliverable,
        sourceBriefId: briefRow.id,
      });
      descriptorIds.push(record.descriptor_id);
    }
    return descriptorIds;
  }

  private async buildSynthesizedDeliverable(
    tenantId: string,
    workflowId: string,
    briefRow: WorkflowOperatorBriefRow,
  ): Promise<UpsertWorkflowDeliverableInput | null> {
    const attributedWorkItemId = await this.resolveDeliverableWorkItemId(tenantId, workflowId, briefRow);
    if (isWorkflowScopedOrchestratorBriefLinkedToChildScope(briefRow) && !attributedWorkItemId) {
      return null;
    }
    const [existingDescriptor, artifacts] = await Promise.all([
      this.loadExistingDescriptor(tenantId, workflowId, briefRow.id),
      this.loadArtifacts(tenantId, workflowId, sanitizeLinkedIdList(briefRow.related_artifact_ids)),
    ]);
    const artifactTargets = artifacts.map((artifact, index) => buildArtifactTarget(artifact, index === 0));
    const headline = readBriefHeadline(briefRow);
    return {
      descriptorId:
        existingDescriptor
        && normalizeNullableText(existingDescriptor.work_item_id) === normalizeNullableText(attributedWorkItemId)
          ? existingDescriptor.id
          : undefined,
      workItemId: attributedWorkItemId,
      descriptorKind: 'brief_packet',
      deliveryStage: 'final',
      title: headline,
      state: 'final',
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

  private async loadExistingDescriptor(
    tenantId: string,
    workflowId: string,
    sourceBriefId: string,
  ): Promise<ExistingDescriptorRow | null> {
    const result = await this.pool.query<ExistingDescriptorRow>(
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

  private async loadArtifacts(
    tenantId: string,
    workflowId: string,
    artifactIds: string[],
  ): Promise<ArtifactRow[]> {
    if (artifactIds.length === 0) {
      return [];
    }
    const result = await this.pool.query<ArtifactRow>(
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

  private async findByRequestId(
    tenantId: string,
    workflowId: string,
    requestId: string,
  ): Promise<WorkflowOperatorBriefRow | null> {
    const result = await this.pool.query<WorkflowOperatorBriefRow>(
      `SELECT *
         FROM workflow_operator_briefs
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND request_id = $3`,
      [tenantId, workflowId, requestId],
    );
    return result.rows[0] ?? null;
  }

  private async nextSequenceNumber(tenantId: string, workflowId: string): Promise<number> {
    const result = await this.pool.query<{ next_sequence: number }>(
      `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence
         FROM workflow_operator_briefs
        WHERE tenant_id = $1
          AND workflow_id = $2`,
      [tenantId, workflowId],
    );
    return Number(result.rows[0]?.next_sequence ?? 1);
  }

  private async assertWorkflow(tenantId: string, workflowId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT id
         FROM workflows
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
  }

  private async assertWorkItem(tenantId: string, workflowId: string, workItemId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT id
         FROM workflow_work_items
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, workflowId, workItemId],
    );
    if (!result.rowCount) {
      throw new ValidationError('Workflow operator brief work item must belong to the selected workflow');
    }
  }

  private async resolveDeliverableWorkItemId(
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

    const directTargets = await this.pool.query<{ id: string }>(
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

    const taskTargets = await this.pool.query<{ work_item_id: string }>(
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
}

function deriveDefaultBriefScope(
  executionContext: ResolvedWorkflowOperatorExecutionContext,
  payload: WorkflowOperatorBriefPayloadInput,
  statusKind: string | null,
): string {
  if (Array.isArray(payload.linkedDeliverables) && payload.linkedDeliverables.length > 0) {
    return 'deliverable_context';
  }
  if (
    (executionContext.workItemId || executionContext.taskId)
    && isDeliverableOutcomeStatus(statusKind)
  ) {
    return 'deliverable_context';
  }
  if (executionContext.workItemId || executionContext.taskId) {
    return 'work_item_handoff';
  }
  return 'workflow_timeline';
}

function isDeliverableOutcomeStatus(statusKind: string | null): boolean {
  return statusKind === 'completed' || statusKind === 'final' || statusKind === 'approved';
}

function resolveEffectiveStatusKind(
  inputStatusKind: string | undefined,
  detailedBriefJson: Record<string, unknown>,
  briefScope: string,
): string {
  return (
    sanitizeOptionalText(inputStatusKind) ??
    sanitizeOptionalText(asRecord(detailedBriefJson).status_kind) ??
    deriveDefaultStatusKind(briefScope)
  );
}

function deriveDefaultStatusKind(briefScope: string): string {
  return briefScope === 'work_item_handoff' ? 'handoff' : 'in_progress';
}

function withDefaultStatusKind(
  detailedBriefJson: Record<string, unknown>,
  statusKind: string,
): Record<string, unknown> {
  const record = asRecord(detailedBriefJson);
  if (sanitizeOptionalText(record.status_kind)) {
    return record;
  }
  return {
    ...record,
    status_kind: statusKind,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function shouldMaterializeDeliverablePacket(brief: WorkflowOperatorBriefRow): boolean {
  if (brief.brief_scope !== 'deliverable_context') {
    return false;
  }
  if (!isDeliverableOutcomeStatus(sanitizeOptionalText(brief.status_kind))) {
    return false;
  }
  if (isChildScopedOrchestratorDeliverableBrief(brief)) {
    return false;
  }
  return true;
}

function isChildScopedOrchestratorDeliverableBrief(brief: WorkflowOperatorBriefRow): boolean {
  if (!isOrchestratorBrief(brief)) {
    return false;
  }
  return Boolean(
    sanitizeOptionalText(brief.work_item_id)
    || sanitizeOptionalText(brief.task_id)
    || isWorkflowScopedOrchestratorBriefLinkedToChildScope(brief),
  );
}

function isWorkflowScopedOrchestratorBriefLinkedToChildScope(brief: WorkflowOperatorBriefRow): boolean {
  if (sanitizeOptionalText(brief.work_item_id)) {
    return false;
  }
  if (!isOrchestratorBrief(brief)) {
    return false;
  }
  const workflowId = sanitizeOptionalText(brief.workflow_id);
  return sanitizeLinkedIdList(brief.linked_target_ids).some((targetId) => targetId !== workflowId);
}

function isOrchestratorBrief(brief: WorkflowOperatorBriefRow): boolean {
  return isOrchestratorRole(brief.source_kind) || isOrchestratorRole(brief.source_role_name);
}

function isOrchestratorRole(value: string | null | undefined): boolean {
  return sanitizeOptionalText(value)?.toLowerCase() === 'orchestrator';
}

function readBriefHeadline(brief: WorkflowOperatorBriefRow): string {
  return sanitizeOptionalText(asRecord(brief.detailed_brief_json).headline)
    ?? sanitizeOptionalText(asRecord(brief.short_brief).headline)
    ?? 'Workflow deliverable packet';
}

function readBriefSummary(brief: WorkflowOperatorBriefRow): string | undefined {
  return sanitizeOptionalText(asRecord(brief.detailed_brief_json).summary)
    ?? sanitizeOptionalText(asRecord(brief.short_brief).headline)
    ?? undefined;
}

function buildBriefPreviewSummary(brief: WorkflowOperatorBriefRow): string {
  const parts = [
    readBriefHeadline(brief),
    sanitizeOptionalText(asRecord(brief.detailed_brief_json).summary),
    brief.source_role_name ? `Produced by: ${brief.source_role_name}` : null,
  ];
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join('\n\n');
}

function buildInlinePreviewCapabilities(): Record<string, unknown> {
  return {
    can_inline_preview: true,
    can_download: false,
    can_open_external: false,
    can_copy_path: false,
    preview_kind: 'structured_summary',
  };
}

function buildInlineSummaryTarget(): Record<string, unknown> {
  return {
    target_kind: 'inline_summary',
    label: 'Review completion packet',
  };
}

function buildArtifactPreviewCapabilities(artifact: ArtifactRow): Record<string, unknown> {
  const contentType = sanitizeOptionalText(artifact.content_type) ?? '';
  return {
    can_inline_preview: true,
    can_download: true,
    can_open_external: false,
    can_copy_path: Boolean(sanitizeOptionalText(artifact.logical_path)),
    preview_kind: contentType.includes('markdown')
      ? 'markdown'
      : contentType.includes('json')
        ? 'json'
        : 'text',
  };
}

function buildArtifactTarget(artifact: ArtifactRow, primary: boolean): Record<string, unknown> {
  return {
    target_kind: 'artifact',
    label: primary ? 'Open artifact' : 'Artifact',
    url: `/api/v1/tasks/${encodeURIComponent(artifact.task_id)}/artifacts/${encodeURIComponent(artifact.id)}/preview`,
    path: sanitizeOptionalText(artifact.logical_path),
    artifact_id: artifact.id,
    size_bytes: artifact.size_bytes,
  };
}

function toWorkflowOperatorBriefRecord(row: WorkflowOperatorBriefRow): WorkflowOperatorBriefRecord {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    work_item_id: row.work_item_id,
    task_id: row.task_id,
    request_id: row.request_id,
    execution_context_id: row.execution_context_id,
    brief_kind: row.brief_kind,
    brief_scope: row.brief_scope,
    source_kind: row.source_kind,
    source_role_name: row.source_role_name,
    llm_turn_count: row.llm_turn_count ?? null,
    status_kind: row.status_kind,
    short_brief: row.short_brief ?? {},
    detailed_brief_json: row.detailed_brief_json ?? {},
    linked_target_ids: row.linked_target_ids ?? [],
    sequence_number: row.sequence_number,
    related_artifact_ids: row.related_artifact_ids ?? [],
    related_output_descriptor_ids: row.related_output_descriptor_ids ?? [],
    related_intervention_ids: row.related_intervention_ids ?? [],
    canonical_workflow_brief_id: row.canonical_workflow_brief_id,
    created_by_type: row.created_by_type,
    created_by_id: row.created_by_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function serializeJsonb(value: unknown): string {
  return JSON.stringify(value);
}

function sanitizeOptionalPositiveInteger(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  return sanitizeOptionalText(value) ?? null;
}
