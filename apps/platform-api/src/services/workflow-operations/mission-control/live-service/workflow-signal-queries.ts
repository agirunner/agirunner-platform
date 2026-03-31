import type { DatabasePool } from '../../../../db/database.js';
import type { WorkflowSignalRow } from './types.js';

export async function loadWorkflowSignals(
  pool: DatabasePool,
  tenantId: string,
  workflowIds: string[],
): Promise<Map<string, WorkflowSignalRow>> {
  if (workflowIds.length === 0) return new Map();
  const result = await pool.query<WorkflowSignalRow>(
    `WITH workflow_scope AS (
       SELECT workflow_id::text AS workflow_id
         FROM UNNEST($2::uuid[]) AS workflow_id
     ),
     task_summary AS (
       SELECT workflow_id::text AS workflow_id,
              COUNT(*) FILTER (WHERE state IN ('awaiting_approval', 'output_pending_assessment'))::int AS waiting_for_decision_count,
              COUNT(*) FILTER (WHERE state = 'failed')::int AS failed_task_count,
              COUNT(*) FILTER (WHERE state IN ('ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment'))::int AS active_task_count
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = ANY($2::uuid[])
          AND is_orchestrator_task = FALSE
        GROUP BY workflow_id
     ),
     active_specialist_work_items AS (
       SELECT workflow_id::text AS workflow_id,
              work_item_id::text AS work_item_id
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = ANY($2::uuid[])
          AND work_item_id IS NOT NULL
          AND is_orchestrator_task = FALSE
          AND state IN ('ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment')
        GROUP BY workflow_id, work_item_id
     ),
     stage_summary AS (
       SELECT workflow_id::text AS workflow_id,
              COUNT(*) FILTER (WHERE gate_status = 'awaiting_approval')::int AS waiting_for_decision_count,
              COUNT(*) FILTER (
                WHERE gate_status IN ('blocked', 'changes_requested', 'rejected')
              )::int AS blocked_stage_count
         FROM workflow_stages
        WHERE tenant_id = $1
          AND workflow_id = ANY($2::uuid[])
        GROUP BY workflow_id
     ),
     work_item_summary AS (
       SELECT wi.workflow_id::text AS workflow_id,
              COUNT(*) FILTER (WHERE wi.completed_at IS NULL AND wi.escalation_status = 'open')::int AS open_escalation_count,
              COUNT(*) FILTER (
                WHERE wi.completed_at IS NULL
                  AND (
                    wi.blocked_state = 'blocked'
                    OR COALESCE(ws.gate_status, 'not_requested') IN ('blocked', 'request_changes', 'changes_requested', 'rejected')
                  )
               )::int AS blocked_work_item_count,
               COUNT(*) FILTER (
                 WHERE wi.completed_at IS NULL
                   AND active_specialist_work_items.work_item_id IS NOT NULL
               )::int AS active_work_item_count,
               COUNT(*) FILTER (
                 WHERE wi.completed_at IS NULL
                   AND active_specialist_work_items.work_item_id IS NULL
                   AND wi.escalation_status IS DISTINCT FROM 'open'
                   AND wi.blocked_state IS DISTINCT FROM 'blocked'
                   AND COALESCE(ws.gate_status, 'not_requested') NOT IN (
                     'awaiting_approval',
                     'blocked',
                     'request_changes',
                     'changes_requested',
                     'rejected'
                   )
               )::int AS pending_work_item_count
          FROM workflow_work_items wi
          LEFT JOIN active_specialist_work_items
            ON active_specialist_work_items.workflow_id = wi.workflow_id::text
           AND active_specialist_work_items.work_item_id = wi.id::text
          LEFT JOIN workflow_stages ws
            ON ws.tenant_id = wi.tenant_id
           AND ws.workflow_id = wi.workflow_id
           AND ws.name = wi.stage_name
         WHERE wi.tenant_id = $1
           AND wi.workflow_id = ANY($2::uuid[])
         GROUP BY wi.workflow_id
     ),
     recovery_events AS (
       SELECT entity_id::text AS workflow_id,
              type,
              data
         FROM events
        WHERE tenant_id = $1
          AND entity_type = 'workflow'
          AND entity_id = ANY($2::uuid[])
       UNION ALL
       SELECT data->>'workflow_id' AS workflow_id,
              type,
              data
         FROM events
        WHERE tenant_id = $1
          AND data->>'workflow_id' = ANY($3::text[])
          AND NOT (
            entity_type = 'workflow'
            AND entity_id = ANY($2::uuid[])
          )
     ),
     recovery_summary AS (
       SELECT workflow_id,
              COUNT(*) FILTER (
                WHERE type IN ('workflow.activation_requeued', 'workflow.activation_stale_detected')
                   OR COALESCE(data->>'mutation_outcome', '') = 'recoverable_not_applied'
              )::int AS recoverable_issue_count
         FROM recovery_events
        GROUP BY workflow_id
     )
     SELECT workflow_scope.workflow_id,
            (
              COALESCE(task_summary.waiting_for_decision_count, 0)
              + COALESCE(stage_summary.waiting_for_decision_count, 0)
            )::int AS waiting_for_decision_count,
            COALESCE(work_item_summary.open_escalation_count, 0)::int AS open_escalation_count,
            (
              COALESCE(work_item_summary.blocked_work_item_count, 0)
              + COALESCE(stage_summary.blocked_stage_count, 0)
            )::int AS blocked_work_item_count,
            COALESCE(task_summary.failed_task_count, 0)::int AS failed_task_count,
            COALESCE(task_summary.active_task_count, 0)::int AS active_task_count,
            COALESCE(work_item_summary.active_work_item_count, 0)::int AS active_work_item_count,
            COALESCE(work_item_summary.pending_work_item_count, 0)::int AS pending_work_item_count,
            COALESCE(recovery_summary.recoverable_issue_count, 0)::int AS recoverable_issue_count
       FROM workflow_scope
       LEFT JOIN task_summary
         ON task_summary.workflow_id = workflow_scope.workflow_id
       LEFT JOIN stage_summary
         ON stage_summary.workflow_id = workflow_scope.workflow_id
       LEFT JOIN work_item_summary
         ON work_item_summary.workflow_id = workflow_scope.workflow_id
       LEFT JOIN recovery_summary
         ON recovery_summary.workflow_id = workflow_scope.workflow_id`,
    [tenantId, workflowIds, workflowIds],
  );

  return new Map(result.rows.map((row) => [row.workflow_id, row]));
}
