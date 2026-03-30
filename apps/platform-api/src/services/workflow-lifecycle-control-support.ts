import type { DatabasePool } from '../db/database.js';

import type { EventService } from './event-service.js';

interface ReopenedTaskRow {
  id: string;
  state: string;
  work_item_id: string | null;
}

type Queryable = {
  query: DatabasePool['query'];
};

export function readLifecycleMarker(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function readLifecycleTaskIds(metadata: unknown, key: string): string[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return [];
  }
  const value = (metadata as Record<string, unknown>)[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((taskId): taskId is string => typeof taskId === 'string' && taskId.trim().length > 0);
}

export async function clearStoppedRuntimeHeartbeatTasks(
  client: Queryable,
  tenantId: string,
  taskIds: string[],
) {
  if (taskIds.length === 0) {
    return;
  }
  await client.query(
    `UPDATE runtime_heartbeats
        SET task_id = NULL,
            state = CASE
              WHEN pool_kind = 'specialist' THEN 'draining'
              ELSE 'idle'
            END
      WHERE tenant_id = $1
        AND task_id = ANY($2::uuid[])`,
    [tenantId, taskIds],
  );
}

export async function reopenPauseCancelledSpecialistTasks(
  client: Queryable,
  eventService: EventService,
  tenantId: string,
  workflowId: string,
  taskIds: string[],
  actorType: string,
  actorId: string,
  options: { reason: string; workItemId?: string | null },
) {
  if (taskIds.length === 0) {
    return;
  }

  const workItemFilterSql = options.workItemId ? 'AND t.work_item_id = $4::uuid' : '';
  const reopenedTasks = await client.query<ReopenedTaskRow>(
    `UPDATE tasks t
        SET state = 'ready',
            state_changed_at = now(),
            completed_at = NULL,
            assigned_agent_id = NULL,
            assigned_worker_id = NULL,
            claimed_at = NULL,
            started_at = NULL
       FROM workflow_work_items wi
      WHERE t.tenant_id = $1
        AND t.workflow_id = $2
        AND t.tenant_id = wi.tenant_id
        AND t.workflow_id = wi.workflow_id
        AND t.work_item_id = wi.id
        AND t.id = ANY($3::uuid[])
        ${workItemFilterSql}
        AND t.is_orchestrator_task = FALSE
        AND t.state = 'cancelled'
        AND t.completed_at IS NULL
        AND t.error IS NULL
        AND COALESCE(t.metadata->>'task_kind', 'delivery') = 'delivery'
        AND wi.completed_at IS NULL
        AND wi.blocked_state IS DISTINCT FROM 'blocked'
        AND wi.escalation_status IS DISTINCT FROM 'open'
    RETURNING t.id, t.state, t.work_item_id`,
    options.workItemId
      ? [tenantId, workflowId, taskIds, options.workItemId]
      : [tenantId, workflowId, taskIds],
  );

  for (const task of reopenedTasks.rows) {
    await eventService.emit(
      {
        tenantId,
        type: 'task.state_changed',
        entityType: 'task',
        entityId: task.id,
        actorType,
        actorId,
        data: {
          from_state: 'cancelled',
          to_state: task.state,
          reason: options.reason,
          workflow_id: workflowId,
          work_item_id: task.work_item_id,
        },
      },
      client,
    );
  }
}
