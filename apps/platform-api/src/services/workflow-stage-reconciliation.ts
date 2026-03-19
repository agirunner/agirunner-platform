import type { DatabaseClient, DatabasePool } from '../db/database.js';
import {
  currentStageNameFromStages,
  normalizeWorkflowStageViews,
  type WorkflowStageResponse,
  type WorkflowStageViewInput,
} from './workflow-stage-service.js';

const STAGE_VIEW_QUERY = `SELECT ws.id,
                                 w.lifecycle,
                                 ws.name,
                                 ws.position,
                                 ws.goal,
                                 ws.guidance,
                                 ws.human_gate,
                                 ws.status,
                                 ws.gate_status,
                                 ws.iteration_count,
                                 ws.summary,
                                 ws.started_at,
                                 ws.completed_at,
                                 COALESCE(work_item_summary.open_work_item_count, 0) AS open_work_item_count,
                                 COALESCE(work_item_summary.total_work_item_count, 0) AS total_work_item_count,
                                 work_item_summary.first_work_item_at,
                                 work_item_summary.last_completed_work_item_at
                            FROM workflow_stages ws
                            JOIN workflows w
                              ON w.tenant_id = ws.tenant_id
                             AND w.id = ws.workflow_id
                            LEFT JOIN LATERAL (
                              SELECT COUNT(*) FILTER (WHERE wi.completed_at IS NULL)::int AS open_work_item_count,
                                     COUNT(*)::int AS total_work_item_count,
                                     MIN(wi.created_at) AS first_work_item_at,
                                     MAX(wi.completed_at) AS last_completed_work_item_at
                                FROM workflow_work_items wi
                               WHERE wi.tenant_id = ws.tenant_id
                                 AND wi.workflow_id = ws.workflow_id
                                 AND wi.stage_name = ws.name
                            ) AS work_item_summary
                              ON true
                           WHERE ws.tenant_id = $1
                             AND ws.workflow_id = $2
                           ORDER BY ws.position ASC`;

interface ReconciledStageRow extends WorkflowStageViewInput {
  id: string;
}

export async function reconcilePlannedWorkflowStages(
  db: DatabaseClient | DatabasePool,
  tenantId: string,
  workflowId: string,
): Promise<{ currentStage: string | null; stages: WorkflowStageResponse[] }> {
  const stageResult = await db.query<ReconciledStageRow>(STAGE_VIEW_QUERY, [tenantId, workflowId]);
  const stages = normalizeWorkflowStageViews(stageResult.rows);

  for (const [index, row] of stageResult.rows.entries()) {
    const stage = stages[index];
    const desiredStartedAt = stage.started_at;
    const desiredCompletedAt = stage.status === 'completed' ? stage.completed_at : null;
    const needsStatusUpdate = row.status !== stage.status;
    const needsStartedAt = desiredStartedAt !== null && row.started_at === null;
    const needsCompletedAt = desiredCompletedAt !== null && row.completed_at === null;
    if (!needsStatusUpdate && !needsStartedAt && !needsCompletedAt) {
      continue;
    }

    await db.query(
      `UPDATE workflow_stages
          SET status = $4,
              started_at = CASE
                WHEN $5::timestamptz IS NULL THEN started_at
                ELSE COALESCE(started_at, $5::timestamptz)
              END,
              completed_at = CASE
                WHEN $6::timestamptz IS NULL THEN completed_at
                ELSE COALESCE(completed_at, $6::timestamptz)
              END,
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, workflowId, row.id, stage.status, desiredStartedAt, desiredCompletedAt],
    );
  }

  const currentStage = currentStageNameFromStages(stages);

  return {
    currentStage,
    stages,
  };
}
