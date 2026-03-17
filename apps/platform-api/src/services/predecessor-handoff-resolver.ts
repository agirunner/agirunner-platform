import type { DatabaseQueryable } from '../db/database.js';

const PREDECESSOR_HANDOFF_FIELDS = `id,
            task_id,
            role,
            stage_name,
            summary,
            completion,
            changes,
            decisions,
            remaining_items,
            blockers,
            review_focus,
            known_risks,
            successor_context,
            role_data,
            artifact_ids,
            created_at`;

export async function loadResolvedPredecessorHandoff(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
) {
  const recent = await loadRecentRelevantHandoffs(db, tenantId, task, 1);
  return recent[0] ?? null;
}

export async function loadRecentRelevantHandoffs(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
  limit = 2,
) {
  const taskId = readOptionalString(task.id);
  const workItemId = readOptionalString(task.work_item_id);
  const workflowId = readOptionalString(task.workflow_id);
  if (!taskId || !workItemId || !workflowId) {
    return [];
  }

  const localHandoffs = await loadWorkItemHandoffs(
    db,
    tenantId,
    workflowId,
    workItemId,
    taskId,
    limit,
  );
  if (localHandoffs.length > 0) {
    return localHandoffs;
  }

  const parentWorkItemId = await loadParentWorkItemId(
    db,
    tenantId,
    workflowId,
    workItemId,
  );
  if (parentWorkItemId) {
    return loadWorkItemHandoffs(
      db,
      tenantId,
      workflowId,
      parentWorkItemId,
      taskId,
      limit,
    );
  }

  return [];
}

async function loadWorkItemHandoffs(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  workItemId: string,
  taskId: string,
  limit: number,
) {
  const result = await db.query(
    `SELECT ${PREDECESSOR_HANDOFF_FIELDS}
       FROM task_handoffs
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND task_id <> $4
      ORDER BY sequence DESC, created_at DESC
      LIMIT $5`,
    [tenantId, workflowId, workItemId, taskId, limit],
  );
  return result.rows as Record<string, unknown>[];
}

async function loadParentWorkItemId(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  workItemId: string,
) {
  const result = await db.query<{ parent_work_item_id: string | null }>(
    `SELECT parent_work_item_id
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, workItemId],
  );
  return readOptionalString(result.rows[0]?.parent_work_item_id) ?? null;
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
