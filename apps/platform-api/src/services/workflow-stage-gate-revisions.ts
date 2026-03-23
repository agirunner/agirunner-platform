import type { DatabaseClient, DatabasePool } from '../db/database.js';
import {
  PLATFORM_APPROVAL_STALE_DECISION_SUPERSESSION_ID,
  mustGetSafetynetEntry,
} from './safetynet/registry.js';
import { logSafetynetTriggered } from './safetynet/logging.js';

export const APPROVAL_STALE_DECISION_SUPERSESSION_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_APPROVAL_STALE_DECISION_SUPERSESSION_ID,
);

interface LatestSubjectRevisionRow {
  latest_subject_revision: number | null;
}

interface SupersedeStageGateInput {
  tenantId: string;
  workflowId: string;
  stageId: string;
  subjectRevision: number | null;
}

interface GateRetentionPolicy {
  approval_retention?: 'invalidate_all' | 'retain_advisory_only' | 'retain_named_assessors' | 'retain_non_material_only';
  required?: boolean;
  materiality?: 'material' | 'non_material';
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
  if ((result.rowCount ?? 0) > 0) {
    logSafetynetTriggered(
      APPROVAL_STALE_DECISION_SUPERSESSION_SAFETYNET,
      'superseded stale stage-gate decisions for newer subject revision',
      {
        workflow_id: input.workflowId,
        stage_id: input.stageId,
        subject_revision: input.subjectRevision,
        superseded_count: result.rowCount ?? 0,
      },
    );
  }
  return result.rowCount ?? 0;
}

export function gateRequiresSupersession(
  subjectRevision: number | null,
  latestGateRevision: number | null | undefined,
  supersededAt: Date | null | undefined,
  retentionPolicy?: GateRetentionPolicy,
) {
  if (supersededAt) {
    return false;
  }
  if (!subjectRevision || subjectRevision <= 0) {
    return false;
  }
  if ((latestGateRevision ?? 0) <= 0 || subjectRevision <= (latestGateRevision ?? 0)) {
    return false;
  }

  const approvalRetention = retentionPolicy?.approval_retention ?? 'invalidate_all';
  if (approvalRetention === 'invalidate_all') {
    return true;
  }
  if (approvalRetention === 'retain_non_material_only') {
    return retentionPolicy?.materiality !== 'non_material';
  }
  if (approvalRetention === 'retain_advisory_only') {
    return retentionPolicy?.required !== false;
  }
  return false;
}
