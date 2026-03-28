import { randomUUID } from 'node:crypto';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseQueryable } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { resolveOperatorRecordActorId } from './operator-record-authorship.js';
import { resolveWorkflowOperatorExecutionContext } from './workflow-operator-execution-context.js';
import {
  sanitizeLinkedIdList,
  sanitizeOperatorUpdateHeadline,
  sanitizeOperatorUpdateSummary,
  sanitizeOptionalText,
  sanitizeRequiredText,
  sanitizeOptionalWorkflowLiveVisibilityMode,
  type WorkflowLiveVisibilityMode,
} from './workflow-operator-record-sanitization.js';

interface WorkflowLiveVisibilityRow {
  id: string;
  live_visibility_mode_override: WorkflowLiveVisibilityMode | null;
  live_visibility_revision: number;
  live_visibility_updated_by_operator_id: string | null;
  live_visibility_updated_at: Date | null;
}

interface WorkflowOperatorUpdateRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string | null;
  request_id: string;
  execution_context_id: string;
  source_kind: string;
  source_role_name: string | null;
  update_kind: string;
  headline: string;
  summary: string | null;
  linked_target_ids: string[] | null;
  visibility_mode: WorkflowLiveVisibilityMode;
  promoted_brief_id: string | null;
  sequence_number: number;
  created_by_type: string;
  created_by_id: string;
  created_at: Date;
}

export interface WorkflowOperatorUpdateRecord {
  id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string | null;
  request_id: string;
  execution_context_id: string;
  source_kind: string;
  source_role_name: string | null;
  update_kind: string;
  headline: string;
  summary: string | null;
  linked_target_ids: string[];
  visibility_mode: WorkflowLiveVisibilityMode;
  promoted_brief_id: string | null;
  sequence_number: number;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
}

export interface WorkflowLiveVisibilityModeRecord {
  workflow_id: string;
  live_visibility_mode_override: WorkflowLiveVisibilityMode | null;
  live_visibility_revision: number;
  live_visibility_updated_by_operator_id: string | null;
  live_visibility_updated_at: string | null;
}

export interface RecordWorkflowOperatorUpdateInput {
  requestId: string;
  executionContextId: string;
  workItemId?: string;
  taskId?: string;
  sourceKind: string;
  sourceRoleName?: string;
  payload: {
    updateKind: string;
    headline: string;
    summary?: string;
    linkedTargetIds?: unknown;
    promotedBriefId?: string;
  };
}

export interface ListWorkflowOperatorUpdatesInput {
  workItemId?: string;
  limit?: number;
}

export interface WorkflowOperatorUpdateWriteResult {
  record_id: string;
  sequence_number: number;
  deduped: boolean;
  record: WorkflowOperatorUpdateRecord;
}

export class WorkflowOperatorUpdateService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async listUpdates(
    tenantId: string,
    workflowId: string,
    input: ListWorkflowOperatorUpdatesInput = {},
  ): Promise<WorkflowOperatorUpdateRecord[]> {
    await this.readWorkflowLiveVisibilityModeOverride(tenantId, workflowId);
    const result = await this.pool.query<WorkflowOperatorUpdateRow>(
      `SELECT *
         FROM workflow_operator_updates
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND ($3::uuid IS NULL OR work_item_id = $3)
        ORDER BY sequence_number DESC
        LIMIT $4`,
      [tenantId, workflowId, input.workItemId ?? null, input.limit ?? 50],
    );
    return result.rows.map(toWorkflowOperatorUpdateRecord);
  }

  async recordUpdate(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: RecordWorkflowOperatorUpdateInput,
  ): Promise<WorkflowOperatorUpdateRecord> {
    const result = await this.recordUpdateWrite(identity, workflowId, input);
    return result.record;
  }

  async recordUpdateWrite(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: RecordWorkflowOperatorUpdateInput,
  ): Promise<WorkflowOperatorUpdateWriteResult> {
    const workflow = await this.assertWorkflow(identity.tenantId, workflowId);
    const executionContext = await resolveWorkflowOperatorExecutionContext(this.pool, identity, workflowId, {
      executionContextId: input.executionContextId,
      sourceKind: input.sourceKind,
      sourceRoleName: input.sourceRoleName,
      workItemId: input.workItemId,
      taskId: input.taskId,
    });
    if (executionContext.workItemId) {
      await this.assertWorkItem(identity.tenantId, workflowId, executionContext.workItemId);
    }
    const existing = await this.findByRequestId(identity.tenantId, workflowId, input.requestId);
    if (existing) {
      const record = toWorkflowOperatorUpdateRecord(existing);
      return {
        record_id: record.id,
        sequence_number: record.sequence_number,
        deduped: true,
        record,
      };
    }

    const sequenceNumber = await this.nextSequenceNumber(identity.tenantId, workflowId);
    const effectiveVisibilityMode = await this.readEffectiveWorkflowLiveVisibilityMode(
      identity.tenantId,
      workflow,
    );
    const result = await this.pool.query<WorkflowOperatorUpdateRow>(
      `INSERT INTO workflow_operator_updates
         (id, tenant_id, workflow_id, work_item_id, task_id, request_id, execution_context_id, source_kind, source_role_name, headline, summary, linked_target_ids, visibility_mode, update_kind, promoted_brief_id, sequence_number, created_by_type, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        randomUUID(),
        identity.tenantId,
        workflowId,
        executionContext.workItemId,
        executionContext.taskId,
        sanitizeRequiredText(input.requestId, 'Workflow operator update request id is required'),
        executionContext.executionContextId,
        executionContext.sourceKind,
        executionContext.sourceRoleName,
        sanitizeOperatorUpdateHeadline(input.payload.headline),
        sanitizeOperatorUpdateSummary(input.payload.summary),
        sanitizeLinkedIdList(input.payload.linkedTargetIds),
        effectiveVisibilityMode,
        sanitizeRequiredText(input.payload.updateKind, 'Workflow operator update kind is required'),
        sanitizeOptionalText(input.payload.promotedBriefId),
        sequenceNumber,
        identity.ownerType,
        resolveOperatorRecordActorId(identity),
      ],
    );
    const record = toWorkflowOperatorUpdateRecord(result.rows[0]);
    return {
      record_id: record.id,
      sequence_number: record.sequence_number,
      deduped: false,
      record,
    };
  }

  async updateWorkflowLiveVisibilityModeOverride(
    identity: ApiKeyIdentity,
    workflowId: string,
    mode: WorkflowLiveVisibilityMode | null,
  ): Promise<WorkflowLiveVisibilityModeRecord> {
    await this.readWorkflowLiveVisibilityModeOverride(identity.tenantId, workflowId);
    const result = await this.pool.query<WorkflowLiveVisibilityRow>(
      `UPDATE workflows
          SET live_visibility_mode_override = $1,
              live_visibility_revision = live_visibility_revision + 1,
              live_visibility_updated_by_operator_id = $2,
              live_visibility_updated_at = now(),
              updated_at = now()
        WHERE tenant_id = $3
          AND id = $4
      RETURNING id, live_visibility_mode_override, live_visibility_revision, live_visibility_updated_by_operator_id, live_visibility_updated_at`,
      [
        sanitizeOptionalWorkflowLiveVisibilityMode(mode),
        resolveOperatorRecordActorId(identity),
        identity.tenantId,
        workflowId,
      ],
    );
    return toWorkflowLiveVisibilityModeRecord(result.rows[0]);
  }

  async readWorkflowLiveVisibilityModeOverride(
    tenantId: string,
    workflowId: string,
  ): Promise<WorkflowLiveVisibilityModeRecord> {
    const result = await this.pool.query<WorkflowLiveVisibilityRow>(
      `SELECT id, live_visibility_mode_override, live_visibility_revision, live_visibility_updated_by_operator_id, live_visibility_updated_at
         FROM workflows
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
    return toWorkflowLiveVisibilityModeRecord(result.rows[0]);
  }

  private async findByRequestId(
    tenantId: string,
    workflowId: string,
    requestId: string,
  ): Promise<WorkflowOperatorUpdateRow | null> {
    const result = await this.pool.query<WorkflowOperatorUpdateRow>(
      `SELECT *
         FROM workflow_operator_updates
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
         FROM workflow_operator_updates
        WHERE tenant_id = $1
          AND workflow_id = $2`,
      [tenantId, workflowId],
    );
    return Number(result.rows[0]?.next_sequence ?? 1);
  }

  private async assertWorkflow(
    tenantId: string,
    workflowId: string,
  ): Promise<WorkflowLiveVisibilityRow> {
    const result = await this.pool.query<WorkflowLiveVisibilityRow>(
      `SELECT id, live_visibility_mode_override
         FROM workflows
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
    return {
      id: result.rows[0].id,
      live_visibility_mode_override: result.rows[0].live_visibility_mode_override ?? null,
      live_visibility_revision: 0,
      live_visibility_updated_by_operator_id: null,
      live_visibility_updated_at: null,
    };
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
      throw new ValidationError('Workflow operator update work item must belong to the selected workflow');
    }
  }
  private async readEffectiveWorkflowLiveVisibilityMode(
    tenantId: string,
    workflow: WorkflowLiveVisibilityRow,
  ): Promise<WorkflowLiveVisibilityMode> {
    if (workflow.live_visibility_mode_override) {
      return workflow.live_visibility_mode_override;
    }
    const result = await this.pool.query<{ live_visibility_mode_default: WorkflowLiveVisibilityMode }>(
      `SELECT live_visibility_mode_default
         FROM agentic_settings
        WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rows[0]?.live_visibility_mode_default ?? 'enhanced';
  }
}

function toWorkflowOperatorUpdateRecord(row: WorkflowOperatorUpdateRow): WorkflowOperatorUpdateRecord {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    work_item_id: row.work_item_id,
    task_id: row.task_id,
    request_id: row.request_id,
    execution_context_id: row.execution_context_id,
    source_kind: row.source_kind,
    source_role_name: row.source_role_name,
    update_kind: row.update_kind,
    headline: row.headline,
    summary: row.summary,
    linked_target_ids: row.linked_target_ids ?? [],
    visibility_mode: row.visibility_mode,
    promoted_brief_id: row.promoted_brief_id,
    sequence_number: row.sequence_number,
    created_by_type: row.created_by_type,
    created_by_id: row.created_by_id,
    created_at: row.created_at.toISOString(),
  };
}

function toWorkflowLiveVisibilityModeRecord(row: WorkflowLiveVisibilityRow): WorkflowLiveVisibilityModeRecord {
  return {
    workflow_id: row.id,
    live_visibility_mode_override: row.live_visibility_mode_override,
    live_visibility_revision: row.live_visibility_revision,
    live_visibility_updated_by_operator_id: row.live_visibility_updated_by_operator_id,
    live_visibility_updated_at: row.live_visibility_updated_at?.toISOString() ?? null,
  };
}
