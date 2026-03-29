import { randomUUID } from 'node:crypto';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseQueryable } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import {
  sanitizeDeliverableContentPreview,
  sanitizeDeliverablePreviewCapabilities,
  sanitizeDeliverableStage,
  sanitizeDeliverableState,
  sanitizeDeliverableSummary,
  sanitizeDeliverableTarget,
  sanitizeDeliverableTargets,
  sanitizeOptionalText,
  sanitizeRequiredText,
} from './workflow-operator-record-sanitization.js';

interface WorkflowDeliverableRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  work_item_id: string | null;
  descriptor_kind: string;
  delivery_stage: string;
  title: string;
  state: string;
  summary_brief: string | null;
  preview_capabilities_json: Record<string, unknown>;
  primary_target_json: Record<string, unknown>;
  secondary_targets_json: Record<string, unknown>[] | null;
  content_preview_json: Record<string, unknown>;
  source_brief_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface WorkflowDeliverableRecord {
  descriptor_id: string;
  workflow_id: string;
  work_item_id: string | null;
  descriptor_kind: string;
  delivery_stage: string;
  title: string;
  state: string;
  summary_brief: string | null;
  preview_capabilities: Record<string, unknown>;
  primary_target: Record<string, unknown>;
  secondary_targets: Record<string, unknown>[];
  content_preview: Record<string, unknown>;
  source_brief_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertWorkflowDeliverableInput {
  descriptorId?: string;
  workItemId?: string;
  descriptorKind: string;
  deliveryStage: string;
  title: string;
  state: string;
  summaryBrief?: string;
  previewCapabilities?: Record<string, unknown>;
  primaryTarget: Record<string, unknown>;
  secondaryTargets?: unknown;
  contentPreview?: Record<string, unknown>;
  sourceBriefId?: string;
}

export interface ListWorkflowDeliverablesInput {
  workItemId?: string;
  includeWorkflowScope?: boolean;
  includeAllWorkItemScopes?: boolean;
  limit?: number;
}

export class WorkflowDeliverableService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async listDeliverables(
    tenantId: string,
    workflowId: string,
    input: ListWorkflowDeliverablesInput = {},
  ): Promise<WorkflowDeliverableRecord[]> {
    await this.assertWorkflow(tenantId, workflowId);
    const scopeQuery = buildDeliverableScopeQuery(input);
    const result = await this.pool.query<WorkflowDeliverableRow>(
      `SELECT *
         FROM workflow_output_descriptors
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND ${scopeQuery.whereClause}
        ORDER BY updated_at DESC, created_at DESC
        LIMIT $${scopeQuery.limitParamIndex}`,
      [tenantId, workflowId, ...scopeQuery.params, input.limit ?? 50],
    );
    return result.rows.map(toWorkflowDeliverableRecord);
  }

  async upsertDeliverable(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: UpsertWorkflowDeliverableInput,
  ): Promise<WorkflowDeliverableRecord> {
    return this.upsertDeliverableForTenant(identity.tenantId, workflowId, input);
  }

  async upsertSystemDeliverable(
    tenantId: string,
    workflowId: string,
    input: UpsertWorkflowDeliverableInput,
  ): Promise<WorkflowDeliverableRecord> {
    return this.upsertDeliverableForTenant(tenantId, workflowId, input);
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
      throw new ValidationError('Workflow deliverable work item must belong to the selected workflow');
    }
  }

  private async assertSourceBrief(tenantId: string, workflowId: string, sourceBriefId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT id
         FROM workflow_operator_briefs
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, workflowId, sourceBriefId],
    );
    if (!result.rowCount) {
      throw new ValidationError('Workflow deliverable source brief must belong to the selected workflow');
    }
  }

  private async upsertDeliverableForTenant(
    tenantId: string,
    workflowId: string,
    input: UpsertWorkflowDeliverableInput,
  ): Promise<WorkflowDeliverableRecord> {
    await this.assertWorkflow(tenantId, workflowId);
    if (input.workItemId) {
      await this.assertWorkItem(tenantId, workflowId, input.workItemId);
    }
    if (input.sourceBriefId) {
      await this.assertSourceBrief(tenantId, workflowId, input.sourceBriefId);
    }

    const descriptorId = sanitizeOptionalText(input.descriptorId) ?? randomUUID();
    const exists = await this.pool.query<{ id: string }>(
      `SELECT id
         FROM workflow_output_descriptors
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, workflowId, descriptorId],
    );

    const params = [
      tenantId,
      sanitizeDeliverableStage(input.deliveryStage),
      sanitizeRequiredText(input.title, 'Workflow deliverable title is required'),
      sanitizeDeliverableState(input.state),
      sanitizeDeliverableSummary(input.summaryBrief),
      sanitizeDeliverablePreviewCapabilities(input.previewCapabilities),
      sanitizeDeliverableTarget(input.primaryTarget),
      sanitizeDeliverableTargets(input.secondaryTargets),
      sanitizeDeliverableContentPreview(input.contentPreview),
      sanitizeOptionalText(input.sourceBriefId),
      workflowId,
      input.workItemId ?? null,
      sanitizeRequiredText(input.descriptorKind, 'Workflow deliverable kind is required'),
      descriptorId,
    ];

    const result = exists.rowCount
      ? await this.pool.query<WorkflowDeliverableRow>(
          `UPDATE workflow_output_descriptors
              SET delivery_stage = $2,
                  title = $3,
                  state = $4,
                  summary_brief = $5,
                  preview_capabilities_json = $6::jsonb,
                  primary_target_json = $7::jsonb,
                  secondary_targets_json = $8::jsonb,
                  content_preview_json = $9::jsonb,
                  source_brief_id = $10,
                  updated_at = now()
            WHERE tenant_id = $1
              AND workflow_id = $11
              AND work_item_id IS NOT DISTINCT FROM $12
              AND descriptor_kind = $13
              AND id = $14
          RETURNING *`,
          params,
        )
      : await this.pool.query<WorkflowDeliverableRow>(
          `INSERT INTO workflow_output_descriptors
             (id, tenant_id, workflow_id, work_item_id, descriptor_kind, delivery_stage, title, state, summary_brief, preview_capabilities_json, primary_target_json, secondary_targets_json, content_preview_json, source_brief_id)
           VALUES ($14,$1,$11,$12,$13,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10)
           RETURNING *`,
          params,
        );

    return toWorkflowDeliverableRecord(result.rows[0]);
  }
}

function buildDeliverableScopeQuery(input: ListWorkflowDeliverablesInput): {
  whereClause: string;
  params: string[];
  limitParamIndex: number;
} {
  if (!input.workItemId) {
    if (input.includeAllWorkItemScopes === true) {
      return {
        whereClause: 'TRUE',
        params: [],
        limitParamIndex: 3,
      };
    }
    return {
      whereClause: 'work_item_id IS NULL',
      params: [],
      limitParamIndex: 3,
    };
  }

  if (input.includeWorkflowScope === true) {
    return {
      whereClause: '(work_item_id = $3 OR work_item_id IS NULL)',
      params: [input.workItemId],
      limitParamIndex: 4,
    };
  }

  return {
    whereClause: 'work_item_id = $3',
    params: [input.workItemId],
    limitParamIndex: 4,
  };
}

function toWorkflowDeliverableRecord(row: WorkflowDeliverableRow): WorkflowDeliverableRecord {
  return {
    descriptor_id: row.id,
    workflow_id: row.workflow_id,
    work_item_id: row.work_item_id,
    descriptor_kind: row.descriptor_kind,
    delivery_stage: row.delivery_stage,
    title: row.title,
    state: row.state,
    summary_brief: row.summary_brief,
    preview_capabilities: row.preview_capabilities_json ?? {},
    primary_target: row.primary_target_json ?? {},
    secondary_targets: row.secondary_targets_json ?? [],
    content_preview: row.content_preview_json ?? {},
    source_brief_id: row.source_brief_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
