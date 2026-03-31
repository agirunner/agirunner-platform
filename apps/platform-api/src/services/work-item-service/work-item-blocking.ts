import type { DatabaseClient, DatabasePool } from '../db/database.js';

export interface BlockWorkflowWorkItemInput {
  tenantId: string;
  workflowId: string;
  workItemId: string;
  reason: string | null;
  blockedColumnId?: string | null;
}

export interface BlockWorkflowStageItemsInput {
  tenantId: string;
  workflowId: string;
  stageName: string;
  reason: string | null;
  blockedColumnId?: string | null;
}

export interface ClearWorkflowWorkItemBlockInput {
  tenantId: string;
  workflowId: string;
  workItemId: string;
}

export async function blockWorkflowWorkItem(
  db: DatabaseClient | DatabasePool,
  input: BlockWorkflowWorkItemInput,
) {
  await db.query(
    `UPDATE workflow_work_items
        SET blocked_state = 'blocked',
            blocked_reason = $4,
            column_id = COALESCE($5, column_id),
            next_expected_actor = NULL,
            next_expected_action = NULL,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3`,
    [input.tenantId, input.workflowId, input.workItemId, input.reason, input.blockedColumnId ?? null],
  );
}

export async function blockWorkflowStageItems(
  db: DatabaseClient | DatabasePool,
  input: BlockWorkflowStageItemsInput,
) {
  await db.query(
    `UPDATE workflow_work_items
        SET blocked_state = 'blocked',
            blocked_reason = $4,
            column_id = COALESCE($5, column_id),
            next_expected_actor = NULL,
            next_expected_action = NULL,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND stage_name = $3
        AND completed_at IS NULL`,
    [input.tenantId, input.workflowId, input.stageName, input.reason, input.blockedColumnId ?? null],
  );
}

export async function clearWorkflowWorkItemBlock(
  db: DatabaseClient | DatabasePool,
  input: ClearWorkflowWorkItemBlockInput,
) {
  await db.query(
    `UPDATE workflow_work_items
        SET blocked_state = NULL,
            blocked_reason = NULL,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3`,
    [input.tenantId, input.workflowId, input.workItemId],
  );
}
