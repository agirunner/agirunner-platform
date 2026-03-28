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
  sanitizeRequiredText,
} from './workflow-operator-record-sanitization.js';

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
  requestId: string;
  executionContextId: string;
  workItemId?: string;
  taskId?: string;
  briefKind: string;
  briefScope: string;
  sourceKind: string;
  sourceRoleName?: string;
  statusKind: string;
  payload: WorkflowOperatorBriefPayloadInput;
  relatedArtifactIds?: unknown;
  relatedInterventionIds?: unknown;
  canonicalWorkflowBriefId?: string;
}

export interface ListWorkflowOperatorBriefsInput {
  workItemId?: string;
  limit?: number;
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
    const result = await this.pool.query<WorkflowOperatorBriefRow>(
      `SELECT *
         FROM workflow_operator_briefs
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND ($3::uuid IS NULL OR work_item_id = $3)
        ORDER BY sequence_number DESC
        LIMIT $4`,
      [tenantId, workflowId, input.workItemId ?? null, input.limit ?? 50],
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
    if (executionContext.workItemId) {
      await this.assertWorkItem(identity.tenantId, workflowId, executionContext.workItemId);
    }
    const existing = await this.findByRequestId(identity.tenantId, workflowId, input.requestId);
    if (existing) {
      const record = toWorkflowOperatorBriefRecord(existing);
      return {
        record_id: record.id,
        sequence_number: record.sequence_number,
        deduped: true,
        record,
      };
    }

    const sequenceNumber = await this.nextSequenceNumber(identity.tenantId, workflowId);
    const shortBrief = sanitizeOperatorShortBrief(input.payload.shortBrief);
    const detailedBriefJson = sanitizeOperatorDetailedBrief(input.payload.detailedBriefJson);
    const linkedTargetIds = sanitizeLinkedIdList(input.payload.linkedTargetIds);
    const inserted = await this.pool.query<WorkflowOperatorBriefRow>(
      `INSERT INTO workflow_operator_briefs
         (id, tenant_id, workflow_id, work_item_id, task_id, request_id, execution_context_id, brief_kind, brief_scope, source_kind, short_brief, detailed_brief_json, status_kind, linked_target_ids, related_artifact_ids, related_output_descriptor_ids, related_intervention_ids, source_role_name, sequence_number, canonical_workflow_brief_id, created_by_type, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20,$21,$22)
       RETURNING *`,
      [
        randomUUID(),
        identity.tenantId,
        workflowId,
        executionContext.workItemId,
        executionContext.taskId,
        sanitizeRequiredText(input.requestId, 'Workflow operator brief request id is required'),
        executionContext.executionContextId,
        sanitizeRequiredText(input.briefKind, 'Workflow operator brief kind is required'),
        sanitizeRequiredText(input.briefScope, 'Workflow operator brief scope is required'),
        executionContext.sourceKind,
        serializeJsonb(shortBrief),
        serializeJsonb(detailedBriefJson),
        sanitizeRequiredText(input.statusKind, 'Workflow operator brief status kind is required'),
        serializeJsonb(linkedTargetIds),
        serializeJsonb(sanitizeLinkedIdList(input.relatedArtifactIds)),
        serializeJsonb([]),
        serializeJsonb(sanitizeLinkedIdList(input.relatedInterventionIds)),
        executionContext.sourceRoleName,
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
    insertedRow: WorkflowOperatorBriefRow,
    payload: WorkflowOperatorBriefPayloadInput,
  ): Promise<WorkflowOperatorBriefRecord> {
    const linkedDescriptorIds = await this.materializeLinkedDeliverables(identity, workflowId, insertedRow.id, payload);
    if (linkedDescriptorIds.length === 0) {
      return toWorkflowOperatorBriefRecord(insertedRow);
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
        serializeJsonb(sanitizeLinkedIdList(insertedRow.related_artifact_ids)),
        identity.tenantId,
        workflowId,
        insertedRow.id,
      ],
    );
    return toWorkflowOperatorBriefRecord(result.rows[0]);
  }

  private async materializeLinkedDeliverables(
    identity: ApiKeyIdentity,
    workflowId: string,
    sourceBriefId: string,
    payload: WorkflowOperatorBriefPayloadInput,
  ): Promise<string[]> {
    if (!this.deliverableService || !Array.isArray(payload.linkedDeliverables) || payload.linkedDeliverables.length === 0) {
      return [];
    }
    const descriptorIds: string[] = [];
    for (const deliverable of payload.linkedDeliverables) {
      const record = await this.deliverableService.upsertDeliverable(identity, workflowId, {
        ...deliverable,
        sourceBriefId,
      });
      descriptorIds.push(record.descriptor_id);
    }
    return descriptorIds;
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
