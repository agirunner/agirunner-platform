import type { DatabaseClient, DatabasePool } from '../db/database.js';

interface LatestSubjectRevisionRow {
  latest_subject_revision: number | null;
}

interface SupersedeStageGateInput {
  tenantId: string;
  workflowId: string;
  stageId: string;
  subjectRevision: number | null;
}

export async function loadLatestStageSubjectRevision(
  db: DatabaseClient | DatabasePool,
  tenantId: string,
  workflowId: string,
  stageName: string,
) {
  const result = await db.query<LatestSubjectRevisionRow>(
    `SELECT COALESCE(MAX(subject_revision), 0)::int AS latest_subject_revision
       FROM (
         SELECT NULLIF(COALESCE(NULLIF(th.role_data->>'subject_revision', '')::int, 0), 0) AS subject_revision
           FROM task_handoffs th
          WHERE th.tenant_id = $1
            AND th.workflow_id = $2
            AND th.stage_name = $3
            AND th.completion = 'full'
            AND COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'
       ) stage_delivery`,
    [tenantId, workflowId, stageName],
  );
  return result.rows[0]?.latest_subject_revision ?? null;
}

export async function supersedeStageGatesForRevision(
  db: DatabaseClient | DatabasePool,
  input: SupersedeStageGateInput,
) {
  if (!input.subjectRevision || input.subjectRevision <= 0) {
    return 0;
  }

  const result = await db.query(
    `UPDATE workflow_stage_gates
        SET superseded_at = now(),
            superseded_by_revision = $4,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND stage_id = $3
        AND superseded_at IS NULL
        AND COALESCE(subject_revision, 0) > 0
        AND subject_revision < $4`,
    [input.tenantId, input.workflowId, input.stageId, input.subjectRevision],
  );
  return result.rowCount ?? 0;
}

export function gateRequiresSupersession(
  subjectRevision: number | null,
  latestGateRevision: number | null | undefined,
  supersededAt: Date | null | undefined,
) {
  if (supersededAt) {
    return false;
  }
  if (!subjectRevision || subjectRevision <= 0) {
    return false;
  }
  return (latestGateRevision ?? 0) > 0 && subjectRevision > (latestGateRevision ?? 0);
}
