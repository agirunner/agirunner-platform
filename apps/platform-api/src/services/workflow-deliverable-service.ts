import { createHash, randomUUID } from 'node:crypto';

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

interface WorkflowWorkItemSettlementRow {
  id: string;
  completed_at: Date | null;
}

const ROLLUP_SOURCE_DESCRIPTOR_ID_KEY = 'rollup_source_descriptor_id';
const ROLLUP_SOURCE_WORK_ITEM_ID_KEY = 'rollup_source_work_item_id';

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

  async reconcileWorkflowRollupsForCompletedWorkItem(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    db: DatabaseQueryable = this.pool,
  ): Promise<void> {
    const workItemSettlement = await this.loadWorkItemSettlement(tenantId, workflowId, workItemId, db);
    if (!workItemSettlement.completed_at) {
      return;
    }
    const sourceDeliverables = await this.loadCurrentFinalDeliverablesForWorkItem(
      tenantId,
      workflowId,
      workItemId,
      db,
    );
    for (const record of sourceDeliverables) {
      await this.syncWorkflowRollupDeliverable(
        tenantId,
        workflowId,
        record,
        workItemSettlement,
        db,
      );
    }
  }

  private async assertWorkflow(
    tenantId: string,
    workflowId: string,
    db: DatabaseQueryable = this.pool,
  ): Promise<void> {
    const result = await db.query(
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

  private async loadWorkItemSettlement(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    db: DatabaseQueryable = this.pool,
  ): Promise<WorkflowWorkItemSettlementRow> {
    const result = await db.query<WorkflowWorkItemSettlementRow>(
      `SELECT id, completed_at
         FROM workflow_work_items
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, workflowId, workItemId],
    );
    if (!result.rowCount) {
      throw new ValidationError('Workflow deliverable work item must belong to the selected workflow');
    }
    return result.rows[0]!;
  }

  private async assertSourceBrief(
    tenantId: string,
    workflowId: string,
    sourceBriefId: string,
    db: DatabaseQueryable = this.pool,
  ): Promise<void> {
    const result = await db.query(
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
    db: DatabaseQueryable = this.pool,
  ): Promise<WorkflowDeliverableRecord> {
    await this.assertWorkflow(tenantId, workflowId, db);
    const workItemSettlement = input.workItemId
      ? await this.loadWorkItemSettlement(tenantId, workflowId, input.workItemId, db)
      : null;
    if (input.sourceBriefId) {
      await this.assertSourceBrief(tenantId, workflowId, input.sourceBriefId, db);
    }

    const descriptorId = sanitizeOptionalText(input.descriptorId) ?? randomUUID();
    const exists = await db.query<{ id: string }>(
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
      serializeJsonbParam(sanitizeDeliverablePreviewCapabilities(input.previewCapabilities)),
      serializeJsonbParam(sanitizeDeliverableTarget(input.primaryTarget)),
      serializeJsonbParam(sanitizeDeliverableTargets(input.secondaryTargets)),
      serializeJsonbParam(sanitizeDeliverableContentPreview(input.contentPreview)),
      sanitizeOptionalText(input.sourceBriefId),
      workflowId,
      input.workItemId ?? null,
      sanitizeRequiredText(input.descriptorKind, 'Workflow deliverable kind is required'),
      descriptorId,
    ];

    const result = exists.rowCount
      ? await db.query<WorkflowDeliverableRow>(
          `UPDATE workflow_output_descriptors
              SET work_item_id = $12,
                  descriptor_kind = $13,
                  delivery_stage = $2,
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
              AND id = $14
          RETURNING *`,
          params,
        )
      : await db.query<WorkflowDeliverableRow>(
          `INSERT INTO workflow_output_descriptors
             (id, tenant_id, workflow_id, work_item_id, descriptor_kind, delivery_stage, title, state, summary_brief, preview_capabilities_json, primary_target_json, secondary_targets_json, content_preview_json, source_brief_id)
           VALUES ($14,$1,$11,$12,$13,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10)
           RETURNING *`,
          params,
        );

    const record = toWorkflowDeliverableRecord(result.rows[0]);
    await this.syncWorkflowRollupDeliverable(tenantId, workflowId, record, workItemSettlement, db);
    return record;
  }

  private async loadCurrentFinalDeliverablesForWorkItem(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    db: DatabaseQueryable = this.pool,
  ): Promise<WorkflowDeliverableRecord[]> {
    const result = await db.query<WorkflowDeliverableRow>(
      `SELECT *
         FROM workflow_output_descriptors
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND work_item_id = $3
          AND state <> 'superseded'
          AND (delivery_stage = 'final' OR state = 'final')
        ORDER BY updated_at DESC, created_at DESC`,
      [tenantId, workflowId, workItemId],
    );
    return result.rows.map(toWorkflowDeliverableRecord);
  }

  private async syncWorkflowRollupDeliverable(
    tenantId: string,
    workflowId: string,
    record: WorkflowDeliverableRecord,
    workItemSettlement: WorkflowWorkItemSettlementRow | null,
    db: DatabaseQueryable = this.pool,
  ): Promise<void> {
    if (!record.work_item_id) {
      return;
    }
    const existingRollupDescriptorId = await this.loadWorkflowRollupDescriptorId(
      tenantId,
      workflowId,
      record.descriptor_id,
      db,
    );
    if (!shouldMaterializeWorkflowRollup(record, workItemSettlement)) {
      if (!existingRollupDescriptorId) {
        return;
      }
      await this.upsertDeliverableForTenant(tenantId, workflowId, {
        descriptorId: existingRollupDescriptorId,
        descriptorKind: record.descriptor_kind,
        deliveryStage: record.delivery_stage,
        title: record.title,
        state: 'superseded',
        summaryBrief: record.summary_brief ?? undefined,
        previewCapabilities: record.preview_capabilities,
        primaryTarget: record.primary_target,
        secondaryTargets: record.secondary_targets,
        contentPreview: buildWorkflowRollupContentPreview(record),
        sourceBriefId: record.source_brief_id ?? undefined,
      }, db);
      return;
    }
    await this.upsertDeliverableForTenant(tenantId, workflowId, {
      descriptorId: existingRollupDescriptorId ?? buildWorkflowRollupDescriptorId(record.descriptor_id),
      descriptorKind: record.descriptor_kind,
      deliveryStage: record.delivery_stage,
      title: record.title,
      state: record.state,
      summaryBrief: record.summary_brief ?? undefined,
      previewCapabilities: record.preview_capabilities,
      primaryTarget: record.primary_target,
      secondaryTargets: record.secondary_targets,
      contentPreview: buildWorkflowRollupContentPreview(record),
      sourceBriefId: record.source_brief_id ?? undefined,
    }, db);
  }

  private async loadWorkflowRollupDescriptorId(
    tenantId: string,
    workflowId: string,
    sourceDescriptorId: string,
    db: DatabaseQueryable = this.pool,
  ): Promise<string | null> {
    const result = await db.query<{ id: string }>(
      `SELECT id
         FROM workflow_output_descriptors
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND work_item_id IS NULL
          AND content_preview_json->>'${ROLLUP_SOURCE_DESCRIPTOR_ID_KEY}' = $3
        LIMIT 1`,
      [tenantId, workflowId, sourceDescriptorId],
    );
    return sanitizeOptionalText(result.rows[0]?.id) ?? null;
  }
}

function serializeJsonbParam(value: Record<string, unknown> | Record<string, unknown>[]): string {
  return JSON.stringify(value);
}

function shouldMaterializeWorkflowRollup(
  record: WorkflowDeliverableRecord,
  workItemSettlement: WorkflowWorkItemSettlementRow | null,
): boolean {
  if (!record.work_item_id) {
    return false;
  }
  if (record.state === 'superseded') {
    return false;
  }
  if (!workItemSettlement?.completed_at) {
    return false;
  }
  return record.delivery_stage === 'final' || record.state === 'final';
}

function buildWorkflowRollupContentPreview(record: WorkflowDeliverableRecord): Record<string, unknown> {
  return {
    ...record.content_preview,
    [ROLLUP_SOURCE_DESCRIPTOR_ID_KEY]: record.descriptor_id,
    [ROLLUP_SOURCE_WORK_ITEM_ID_KEY]: record.work_item_id,
  };
}

function buildWorkflowRollupDescriptorId(sourceDescriptorId: string): string {
  const hex = createHash('sha256').update(`workflow-rollup:${sourceDescriptorId}`).digest('hex').slice(0, 32);
  const clockSeq = (Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${clockSeq.toString(16).padStart(2, '0')}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-');
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
