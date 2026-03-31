import type { DatabasePool } from '../../../../db/database.js';
import type { ArtifactOutputRow, DocumentOutputRow } from './types.js';

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
