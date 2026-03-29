import type { DatabaseQueryable } from '../db/database.js';

interface WorkItemIdRow {
  id: string;
}

interface DeliverableIdRow {
  id: string;
}

export class WorkflowDeliverableLifecycleService {
  constructor(private readonly pool: DatabaseQueryable) {}

  listIncompleteWorkItemIds(
    tenantId: string,
    workflowId: string,
    input: { workItemId?: string } = {},
  ): Promise<string[]> {
    return listIncompleteWorkItemIds(this.pool, tenantId, workflowId, input);
  }
}

export async function listIncompleteWorkItemIds(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  input: { workItemId?: string } = {},
): Promise<string[]> {
  const result = await db.query<WorkItemIdRow>(
    `SELECT id
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND completed_at IS NULL
        AND ($3::uuid IS NULL OR id = $3::uuid)`,
    [tenantId, workflowId, input.workItemId ?? null],
  );
  return result.rows.map((row) => row.id);
}

export async function supersedeCurrentFinalDeliverablesForWorkItem(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  workItemId: string,
): Promise<string[]> {
  const result = await db.query<DeliverableIdRow>(
    `UPDATE workflow_output_descriptors
        SET state = 'superseded',
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND state <> 'superseded'
        AND (delivery_stage = 'final' OR state = 'final')
    RETURNING id`,
    [tenantId, workflowId, workItemId],
  );
  return result.rows.map((row) => row.id);
}
