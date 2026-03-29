import type { DatabaseQueryable } from '../db/database.js';
import { defaultColumnId, parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import type { EventService } from './event-service.js';
import type { StopWorkflowBoundExecutionInput } from './workflow-execution-stop-service.js';

interface CancelledWorkflowTaskRow {
  id: string;
  is_orchestrator_task: boolean;
  work_item_id: string | null;
}

export async function reconcileStoppedWorkItemColumns(
  db: DatabaseQueryable,
  eventService: EventService,
  input: StopWorkflowBoundExecutionInput,
  cancelledTasks: CancelledWorkflowTaskRow[],
): Promise<void> {
  const workItemIds = Array.from(new Set(
    cancelledTasks
      .filter((task) => task.is_orchestrator_task !== true && typeof task.work_item_id === 'string')
      .map((task) => task.work_item_id as string),
  ));
  for (const workItemId of workItemIds) {
    const workItem = await db.query<{
      stage_name: string | null;
      column_id: string | null;
      completed_at: Date | null;
      blocked_state: string | null;
      escalation_status: string | null;
      definition: unknown;
    }>(
      `SELECT wi.stage_name, wi.column_id, wi.completed_at, wi.blocked_state, wi.escalation_status, p.definition
         FROM workflow_work_items wi
         JOIN workflows w ON w.tenant_id = wi.tenant_id AND w.id = wi.workflow_id
         JOIN playbooks p ON p.tenant_id = w.tenant_id AND p.id = w.playbook_id
        WHERE wi.tenant_id = $1 AND wi.workflow_id = $2 AND wi.id = $3
        LIMIT 1
        FOR UPDATE OF wi`,
      [input.tenantId, input.workflowId, workItemId],
    );
    const row = workItem.rows[0];
    if (!row || row.completed_at || row.blocked_state === 'blocked' || row.escalation_status === 'open') {
      continue;
    }

    const entryColumnId = defaultColumnId(parsePlaybookDefinition(row.definition));
    if (!entryColumnId || entryColumnId === row.column_id) {
      continue;
    }

    const activeTasks = await db.query<{ active_specialist_task_count: number }>(
      `SELECT COUNT(*)::int AS active_specialist_task_count
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND work_item_id = $3
          AND is_orchestrator_task = FALSE
          AND state IN ('ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment')`,
      [input.tenantId, input.workflowId, workItemId],
    );
    if (Number(activeTasks.rows[0]?.active_specialist_task_count ?? 0) > 0) {
      continue;
    }

    const moved = await db.query<{ id: string }>(
      `UPDATE workflow_work_items
          SET column_id = $4,
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
          AND completed_at IS NULL
      RETURNING id`,
      [input.tenantId, input.workflowId, workItemId, entryColumnId],
    );
    if (!moved.rowCount) {
      continue;
    }

    const data = {
      workflow_id: input.workflowId,
      work_item_id: workItemId,
      stage_name: row.stage_name,
      previous_column_id: row.column_id,
      column_id: entryColumnId,
    };
    await eventService.emit(
      {
        tenantId: input.tenantId,
        type: 'work_item.updated',
        entityType: 'work_item',
        entityId: workItemId,
        actorType: input.actorType,
        actorId: input.actorId,
        data,
      },
      db,
    );
    await eventService.emit(
      {
        tenantId: input.tenantId,
        type: 'work_item.moved',
        entityType: 'work_item',
        entityId: workItemId,
        actorType: input.actorType,
        actorId: input.actorId,
        data,
      },
      db,
    );
  }
}
