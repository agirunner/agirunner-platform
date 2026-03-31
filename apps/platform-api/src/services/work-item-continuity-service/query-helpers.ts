import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import type {
  CurrentFinishStateRow,
  NewerSpecialistHandoffRow,
  WorkItemContinuityContextRow,
  WorkflowActivationQueuedAtRow,
} from './types.js';
import { readOptionalString } from './value-helpers.js';

export async function loadCurrentFinishState(
  tenantId: string,
  workflowId: string,
  workItemId: string,
  db: DatabaseClient | DatabasePool,
) {
  const result = await db.query<CurrentFinishStateRow>(
    `SELECT next_expected_actor,
            next_expected_action,
            parent_work_item_id,
            metadata
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, workItemId],
  );
  return result.rows[0] ?? null;
}

export async function hasNewerSpecialistHandoffSinceActivation(
  tenantId: string,
  workflowId: string,
  workItemId: string,
  parentWorkItemId: string | null,
  activationId: string | null,
  db: DatabaseClient | DatabasePool,
) {
  if (!activationId) {
    return false;
  }

  const activationResult = await db.query<WorkflowActivationQueuedAtRow>(
    `SELECT queued_at
       FROM workflow_activations
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, activationId],
  );
  const queuedAt = activationResult.rows[0]?.queued_at;
  if (!(queuedAt instanceof Date)) {
    return false;
  }

  const scopedWorkItemIds = [workItemId];
  if (parentWorkItemId) {
    scopedWorkItemIds.push(parentWorkItemId);
  }

  const handoffResult = await db.query<NewerSpecialistHandoffRow>(
    `SELECT EXISTS (
        SELECT 1
          FROM task_handoffs h
         JOIN tasks t
            ON t.tenant_id = h.tenant_id
           AND t.id = h.task_id
         WHERE h.tenant_id = $1
           AND h.workflow_id = $2
           AND h.created_at > $3
           AND COALESCE(t.is_orchestrator_task, FALSE) = FALSE
           AND h.work_item_id = ANY($4::uuid[])
      ) AS has_newer_specialist_handoff`,
    [tenantId, workflowId, queuedAt, scopedWorkItemIds],
  );
  return handoffResult.rows[0]?.has_newer_specialist_handoff ?? false;
}

export async function loadContext(
  tenantId: string,
  task: Record<string, unknown>,
  db: DatabaseClient | DatabasePool,
) {
  const workflowId = readOptionalString(task.workflow_id);
  const workItemId = readOptionalString(task.work_item_id);
  if (!workflowId || !workItemId) {
    return null;
  }

  const result = await db.query<WorkItemContinuityContextRow>(
    `SELECT wi.workflow_id,
            wi.id AS work_item_id,
            wi.stage_name,
            wi.rework_count,
            wi.owner_role,
            wi.next_expected_actor,
            wi.next_expected_action,
            pb.definition
       FROM workflow_work_items wi
       JOIN workflows w
         ON w.tenant_id = wi.tenant_id
        AND w.id = wi.workflow_id
       JOIN playbooks pb
         ON pb.tenant_id = w.tenant_id
        AND pb.id = w.playbook_id
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.id = $3
      LIMIT 1`,
    [tenantId, workflowId, workItemId],
  );
  return result.rows[0] ?? null;
}

export async function loadTaskRole(
  tenantId: string,
  workflowId: string,
  taskId: string,
  db: DatabaseClient | DatabasePool,
) {
  const result = await db.query<{ role: string | null }>(
    `SELECT role
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, taskId],
  );
  return readOptionalString(result.rows[0]?.role);
}

export async function loadLatestDeliveryHandoffRole(
  tenantId: string,
  workflowId: string,
  workItemId: string,
  db: DatabaseClient | DatabasePool,
) {
  const result = await db.query<{ role: string | null }>(
    `SELECT role
       FROM task_handoffs
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND COALESCE(role_data->>'task_kind', '') = 'delivery'
      ORDER BY sequence DESC, created_at DESC
      LIMIT 1`,
    [tenantId, workflowId, workItemId],
  );
  return readOptionalString(result.rows[0]?.role);
}
