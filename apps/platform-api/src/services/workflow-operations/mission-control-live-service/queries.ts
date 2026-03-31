import type { DatabasePool } from '../../../db/database.js';
import type {
  ArtifactOutputRow,
  DocumentOutputRow,
  WorkflowRow,
  WorkflowSignalRow,
} from './types.js';

export async function getLatestEventId(
  pool: DatabasePool,
  tenantId: string,
): Promise<number | null> {
  const result = await pool.query<{ latest_event_id: number | null }>(
    'SELECT MAX(id)::int AS latest_event_id FROM events WHERE tenant_id = $1',
    [tenantId],
  );
  return result.rows[0]?.latest_event_id ?? null;
}

export async function loadWorkflowRows(
  pool: DatabasePool,
  tenantId: string,
  input: {
    workflowIds?: string[];
    page?: number;
    perPage?: number;
    lifecycleFilter?: 'all' | 'ongoing' | 'planned';
  },
): Promise<WorkflowRow[]> {
  if (input.workflowIds && input.workflowIds.length > 0) {
    const result = await pool.query<WorkflowRow>(
      `SELECT w.id, w.name, w.state, w.lifecycle, w.current_stage, w.metadata, w.workspace_id,
              ws.name AS workspace_name, w.playbook_id, pb.name AS playbook_name,
              w.parameters, w.context, w.updated_at
         FROM workflows w
         LEFT JOIN workspaces ws ON ws.tenant_id = w.tenant_id AND ws.id = w.workspace_id
         LEFT JOIN playbooks pb ON pb.tenant_id = w.tenant_id AND pb.id = w.playbook_id
        WHERE w.tenant_id = $1
          AND w.id = ANY($2::uuid[])
        ORDER BY w.updated_at DESC`,
      [tenantId, input.workflowIds],
    );
    return result.rows;
  }

  const page = input.page ?? 1;
  const perPage = input.perPage ?? 100;
  const offset = (page - 1) * perPage;
  const lifecycleFilter = input.lifecycleFilter ?? 'all';
  const result = lifecycleFilter === 'all'
    ? await pool.query<WorkflowRow>(
      `SELECT w.id, w.name, w.state, w.lifecycle, w.current_stage, w.metadata, w.workspace_id,
              ws.name AS workspace_name, w.playbook_id, pb.name AS playbook_name,
              w.parameters, w.context, w.updated_at
         FROM workflows w
         LEFT JOIN workspaces ws ON ws.tenant_id = w.tenant_id AND ws.id = w.workspace_id
         LEFT JOIN playbooks pb ON pb.tenant_id = w.tenant_id AND pb.id = w.playbook_id
        WHERE w.tenant_id = $1
        ORDER BY w.updated_at DESC
        LIMIT $2 OFFSET $3`,
      [tenantId, perPage, offset],
    )
    : await pool.query<WorkflowRow>(
      `SELECT w.id, w.name, w.state, w.lifecycle, w.current_stage, w.metadata, w.workspace_id,
              ws.name AS workspace_name, w.playbook_id, pb.name AS playbook_name,
              w.parameters, w.context, w.updated_at
         FROM workflows w
         LEFT JOIN workspaces ws ON ws.tenant_id = w.tenant_id AND ws.id = w.workspace_id
         LEFT JOIN playbooks pb ON pb.tenant_id = w.tenant_id AND pb.id = w.playbook_id
        WHERE w.tenant_id = $1
          AND w.lifecycle = $2
        ORDER BY w.updated_at DESC
        LIMIT $3 OFFSET $4`,
      [tenantId, lifecycleFilter, perPage, offset],
    );
  return result.rows;
}

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

export async function loadWorkflowOutputRows(
  pool: DatabasePool,
  tenantId: string,
  workflowIds: string[],
  limitPerWorkflow: number,
): Promise<{
  artifactRows: ArtifactOutputRow[];
  documentRows: DocumentOutputRow[];
}> {
  if (workflowIds.length === 0) {
    return { artifactRows: [], documentRows: [] };
  }

  const [artifactRows, documentRows] = await Promise.all([
    pool.query<ArtifactOutputRow>(
      `SELECT workflow_id,
              artifact_id,
              task_id,
              work_item_id,
              stage_name,
              task_state,
              work_item_completed_at,
              workflow_state,
              logical_path,
              content_type
         FROM (
           SELECT workflow_artifacts.workflow_id,
                  workflow_artifacts.id AS artifact_id,
                  workflow_artifacts.task_id,
                  task_scope.work_item_id,
                  task_scope.stage_name,
                  task_scope.task_state,
                  task_scope.work_item_completed_at,
                  workflow_scope.state AS workflow_state,
                  workflow_artifacts.logical_path,
                  workflow_artifacts.content_type,
                  workflow_artifacts.size_bytes,
                  ROW_NUMBER() OVER (
                    PARTITION BY workflow_artifacts.workflow_id
                    ORDER BY workflow_artifacts.created_at DESC
                  ) AS rn
             FROM workflow_artifacts
             LEFT JOIN LATERAL (
               SELECT t.work_item_id,
                      t.stage_name,
                      t.state AS task_state,
                      wi.completed_at AS work_item_completed_at
                 FROM tasks t
                 LEFT JOIN workflow_work_items wi
                   ON wi.tenant_id = t.tenant_id
                  AND wi.workflow_id = t.workflow_id
                  AND wi.id = t.work_item_id
                WHERE t.tenant_id = workflow_artifacts.tenant_id
                  AND t.id = workflow_artifacts.task_id
                LIMIT 1
             ) task_scope ON true
             LEFT JOIN workflows workflow_scope
               ON workflow_scope.tenant_id = workflow_artifacts.tenant_id
              AND workflow_scope.id = workflow_artifacts.workflow_id
            WHERE workflow_artifacts.tenant_id = $1
              AND workflow_artifacts.workflow_id = ANY($2::uuid[])
         ) ranked
        WHERE rn <= $3`,
      [tenantId, workflowIds, limitPerWorkflow],
    ),
    pool.query<DocumentOutputRow>(
      `SELECT workflow_id, document_id, logical_name, title, source, location, artifact_id
         FROM (
           SELECT workflow_id,
                  id AS document_id,
                  logical_name,
                  title,
                  source,
                  location,
                  artifact_id,
                  ROW_NUMBER() OVER (PARTITION BY workflow_id ORDER BY created_at DESC) AS rn
             FROM workflow_documents
            WHERE tenant_id = $1
              AND workflow_id = ANY($2::uuid[])
         ) ranked
        WHERE rn <= $3`,
      [tenantId, workflowIds, limitPerWorkflow],
    ),
  ]);

  return { artifactRows: artifactRows.rows, documentRows: documentRows.rows };
}
