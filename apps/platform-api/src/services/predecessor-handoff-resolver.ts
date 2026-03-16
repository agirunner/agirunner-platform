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
  const taskId = readOptionalString(task.id);
  const workItemId = readOptionalString(task.work_item_id);
  const workflowId = readOptionalString(task.workflow_id);
  if (!taskId || !workItemId || !workflowId) {
    return null;
  }

  const localHandoff = await loadLatestWorkItemHandoff(
    db,
    tenantId,
    workflowId,
    workItemId,
    taskId,
  );
  if (localHandoff) {
    return localHandoff;
  }

  const parentWorkItemId = await loadParentWorkItemId(
    db,
    tenantId,
    workflowId,
    workItemId,
  );
  if (parentWorkItemId) {
    const parentHandoff = await loadLinkedWorkItemHandoff(
      db,
      tenantId,
      workflowId,
      taskId,
      parentWorkItemId,
    );
    if (parentHandoff) {
      return parentHandoff;
    }
  }

  return loadLatestWorkflowHandoff(db, tenantId, workflowId, taskId);
}

async function loadLatestWorkItemHandoff(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  workItemId: string,
  taskId: string,
) {
  const result = await db.query(
    `SELECT ${PREDECESSOR_HANDOFF_FIELDS}
       FROM task_handoffs
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND task_id <> $4
      ORDER BY sequence DESC, created_at DESC
      LIMIT 1`,
    [tenantId, workflowId, workItemId, taskId],
  );
  return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
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

async function loadLinkedWorkItemHandoff(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  taskId: string,
  linkedWorkItemId: string,
) {
  const result = await db.query(
    `SELECT ${PREDECESSOR_HANDOFF_FIELDS}
       FROM task_handoffs
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND task_id <> $3
        AND work_item_id = $4
      ORDER BY sequence DESC, created_at DESC
      LIMIT 1`,
    [tenantId, workflowId, taskId, linkedWorkItemId],
  );
  return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
}

async function loadLatestWorkflowHandoff(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  taskId: string,
) {
  const result = await db.query(
    `SELECT ${PREDECESSOR_HANDOFF_FIELDS}
       FROM task_handoffs
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND task_id <> $3
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId, workflowId, taskId],
  );
  return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
