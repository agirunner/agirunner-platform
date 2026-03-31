import type { DatabaseQueryable } from '../../db/database.js';

const PREDECESSOR_HANDOFF_FIELDS = `id,
            workflow_id,
            work_item_id,
            task_id,
            role,
            stage_name,
            sequence,
            summary,
            completion,
            changes,
            decisions,
            remaining_items,
            blockers,
            focus_areas,
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
  const resolution = await resolveRelevantHandoffs(db, tenantId, task, 1);
  return resolution.handoffs[0] ?? null;
}

export async function loadRecentRelevantHandoffs(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
  limit = 2,
) {
  const resolution = await resolveRelevantHandoffs(db, tenantId, task, limit);
  return resolution.handoffs;
}

export interface RelevantHandoffResolution {
  handoffs: Record<string, unknown>[];
  source: 'local_work_item' | 'parent_work_item' | 'ambiguous_parent_work_item' | 'none';
  source_work_item_id: string | null;
  parent_work_item_id: string | null;
  sibling_count: number | null;
}

export async function resolveRelevantHandoffs(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
  limit = 2,
): Promise<RelevantHandoffResolution> {
  const taskId = readOptionalString(task.id);
  const workItemId = readOptionalString(task.work_item_id);
  const workflowId = readOptionalString(task.workflow_id);
  if (!taskId || !workItemId || !workflowId) {
    return buildEmptyResolution();
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
    return {
      handoffs: localHandoffs,
      source: 'local_work_item',
      source_work_item_id: workItemId,
      parent_work_item_id: null,
      sibling_count: null,
    };
  }

  const parentWorkItemId = await loadParentWorkItemId(
    db,
    tenantId,
    workflowId,
    workItemId,
  );
  if (parentWorkItemId) {
    const siblingCount = await countSiblingWorkItems(
      db,
      tenantId,
      workflowId,
      parentWorkItemId,
    );
    if (siblingCount > 1) {
      return {
        handoffs: [],
        source: 'ambiguous_parent_work_item',
        source_work_item_id: null,
        parent_work_item_id: parentWorkItemId,
        sibling_count: siblingCount,
      };
    }
    return {
      handoffs: await loadAncestorLineageHandoffs(
        db,
        tenantId,
        workflowId,
        taskId,
        parentWorkItemId,
        limit,
      ),
      source: 'parent_work_item',
      source_work_item_id: parentWorkItemId,
      parent_work_item_id: parentWorkItemId,
      sibling_count: siblingCount,
    };
  }

  return buildEmptyResolution();
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

async function loadAncestorLineageHandoffs(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  taskId: string,
  startWorkItemId: string,
  limit: number,
) {
  const handoffs: Record<string, unknown>[] = [];
  let currentWorkItemId: string | null = startWorkItemId;

  while (currentWorkItemId && handoffs.length < limit) {
    const remaining = limit - handoffs.length;
    const currentHandoffs = await loadWorkItemHandoffs(
      db,
      tenantId,
      workflowId,
      currentWorkItemId,
      taskId,
      remaining,
    );
    handoffs.push(...currentHandoffs);
    if (handoffs.length >= limit) {
      break;
    }

    const nextParentWorkItemId = await loadParentWorkItemId(
      db,
      tenantId,
      workflowId,
      currentWorkItemId,
    );
    if (!nextParentWorkItemId) {
      break;
    }

    const nextSiblingCount = await countSiblingWorkItems(
      db,
      tenantId,
      workflowId,
      nextParentWorkItemId,
    );
    if (nextSiblingCount > 1) {
      break;
    }

    currentWorkItemId = nextParentWorkItemId;
  }

  return handoffs;
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

async function countSiblingWorkItems(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  parentWorkItemId: string,
) {
  const result = await db.query<{ sibling_count: number }>(
    `SELECT COUNT(*)::int AS sibling_count
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND parent_work_item_id = $3`,
    [tenantId, workflowId, parentWorkItemId],
  );
  return result.rows[0]?.sibling_count ?? 0;
}

function buildEmptyResolution(): RelevantHandoffResolution {
  return {
    handoffs: [],
    source: 'none',
    source_work_item_id: null,
    parent_work_item_id: null,
    sibling_count: null,
  };
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
