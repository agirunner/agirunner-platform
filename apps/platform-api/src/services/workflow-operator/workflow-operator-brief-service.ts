import { randomUUID } from 'node:crypto';

import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseQueryable } from '../../db/database.js';
import { NotFoundError, ValidationError } from '../../errors/domain-errors.js';
import { resolveOperatorRecordActorId } from '../operator-record-authorship.js';
import {
  resolveWorkflowOperatorExecutionContext,
  type ResolvedWorkflowOperatorExecutionContext,
} from './workflow-operator-execution-context.js';
import type { UpsertWorkflowDeliverableInput, WorkflowDeliverableService } from '../workflow-deliverables/workflow-deliverable-service.js';
import {
  sanitizeLinkedIdList,
  sanitizeOperatorDetailedBrief,
  sanitizeOperatorShortBrief,
  sanitizeOptionalText,
} from './workflow-operator-record-sanitization.js';
import {
  deriveDefaultBriefScope,
  resolveEffectiveStatusKind,
  sanitizeOptionalPositiveInteger,
  serializeJsonb,
  toWorkflowOperatorBriefRecord,
  withDefaultStatusKind,
} from './workflow-operator-brief-service.domain.js';
import { syncLinkedDeliverables } from './workflow-operator-brief-service.persistence.js';
import type {
  WorkflowOperatorBriefRow,
} from './workflow-operator-brief-service.types.js';

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
    return syncLinkedDeliverables(this.pool, this.deliverableService, identity, workflowId, briefRow, payload);
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
