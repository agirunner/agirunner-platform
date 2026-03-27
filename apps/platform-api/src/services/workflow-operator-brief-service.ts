import { randomUUID } from 'node:crypto';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseQueryable } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { resolveOperatorRecordActorId } from './operator-record-authorship.js';
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
  shortBrief: Record<string, unknown>;
  detailedBriefJson: Record<string, unknown>;
  relatedArtifactIds?: unknown;
  relatedOutputDescriptorIds?: unknown;
  relatedInterventionIds?: unknown;
  canonicalWorkflowBriefId?: string;
}

export class WorkflowOperatorBriefService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async recordBrief(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: RecordWorkflowOperatorBriefInput,
  ): Promise<WorkflowOperatorBriefRecord> {
    await this.assertWorkflow(identity.tenantId, workflowId);
    if (input.workItemId) {
      await this.assertWorkItem(identity.tenantId, workflowId, input.workItemId);
    }
    if (input.taskId) {
      await this.assertTask(identity.tenantId, workflowId, input.taskId);
    }
    const existing = await this.findByRequestId(identity.tenantId, workflowId, input.requestId);
    if (existing) {
      return toWorkflowOperatorBriefRecord(existing);
    }

    const sequenceNumber = await this.nextSequenceNumber(identity.tenantId, workflowId);
    const shortBrief = sanitizeOperatorShortBrief(input.shortBrief);
    const detailedBriefJson = sanitizeOperatorDetailedBrief(input.detailedBriefJson);
    const result = await this.pool.query<WorkflowOperatorBriefRow>(
      `INSERT INTO workflow_operator_briefs
         (id, tenant_id, workflow_id, work_item_id, task_id, request_id, execution_context_id, brief_kind, brief_scope, source_kind, short_brief, detailed_brief_json, status_kind, related_artifact_ids, related_output_descriptor_ids, related_intervention_ids, source_role_name, sequence_number, canonical_workflow_brief_id, created_by_type, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18,$19,$20,$21)
       RETURNING *`,
      [
        randomUUID(),
        identity.tenantId,
        workflowId,
        input.workItemId ?? null,
        input.taskId ?? null,
        sanitizeRequiredText(input.requestId, 'Workflow operator brief request id is required'),
        sanitizeRequiredText(
          input.executionContextId,
          'Workflow operator brief execution context id is required',
        ),
        sanitizeRequiredText(input.briefKind, 'Workflow operator brief kind is required'),
        sanitizeRequiredText(input.briefScope, 'Workflow operator brief scope is required'),
        sanitizeRequiredText(input.sourceKind, 'Workflow operator brief source kind is required'),
        shortBrief,
        detailedBriefJson,
        sanitizeRequiredText(input.statusKind, 'Workflow operator brief status kind is required'),
        sanitizeLinkedIdList(input.relatedArtifactIds),
        sanitizeLinkedIdList(input.relatedOutputDescriptorIds),
        sanitizeLinkedIdList(input.relatedInterventionIds),
        sanitizeOptionalText(input.sourceRoleName),
        sequenceNumber,
        sanitizeOptionalText(input.canonicalWorkflowBriefId),
        identity.ownerType,
        resolveOperatorRecordActorId(identity),
      ],
    );
    return toWorkflowOperatorBriefRecord(result.rows[0]);
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

  private async assertTask(tenantId: string, workflowId: string, taskId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT id
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, workflowId, taskId],
    );
    if (!result.rowCount) {
      throw new ValidationError('Workflow operator brief task must belong to the selected workflow');
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
