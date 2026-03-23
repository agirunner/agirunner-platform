import type { DatabaseClient, DatabasePool } from '../db/database.js';

interface SubjectRef {
  kind: 'task' | 'work_item' | 'handoff' | 'branch';
  task_id?: string | null;
  work_item_id?: string | null;
  handoff_id?: string | null;
  branch_id?: string | null;
}

export interface OpenWorkItemEscalationInput {
  tenantId: string;
  workflowId: string;
  workItemId: string;
  subjectRef: SubjectRef;
  subjectRevision: number | null;
  reason: string;
  createdByTaskId: string | null;
}

export interface ResolveWorkItemEscalationInput {
  tenantId: string;
  workflowId: string;
  workItemId: string;
  escalationId: string;
  resolutionAction: 'dismiss' | 'unblock_subject' | 'reopen_subject';
  feedback: string | null;
  resolvedByType: string;
  resolvedById: string;
}

export async function openWorkItemEscalation(
  db: DatabaseClient | DatabasePool,
  input: OpenWorkItemEscalationInput,
) {
  const existing = await db.query<{ id: string }>(
    `SELECT id
       FROM workflow_subject_escalations
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND status = 'open'
      LIMIT 1`,
    [input.tenantId, input.workflowId, input.workItemId],
  );
  if (!existing.rowCount) {
    await db.query(
      `INSERT INTO workflow_subject_escalations (
          tenant_id,
          workflow_id,
          work_item_id,
          subject_ref,
          subject_revision,
          reason,
          status,
          created_by_task_id
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'open', $7)`,
      [
        input.tenantId,
        input.workflowId,
        input.workItemId,
        input.subjectRef,
        input.subjectRevision,
        input.reason,
        input.createdByTaskId,
      ],
    );
  }

  await db.query(
    `UPDATE workflow_work_items
        SET escalation_status = 'open',
            next_expected_actor = NULL,
            next_expected_action = NULL,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3`,
    [input.tenantId, input.workflowId, input.workItemId],
  );
}

export async function resolveWorkItemEscalation(
  db: DatabaseClient | DatabasePool,
  input: ResolveWorkItemEscalationInput,
) {
  const nextStatus = input.resolutionAction === 'dismiss' ? 'dismissed' : 'resolved';
  await db.query(
    `UPDATE workflow_subject_escalations
        SET status = $5,
            resolution_action = $6,
            resolution_feedback = $7,
            resolved_by_type = $8,
            resolved_by_id = $9,
            resolved_at = now(),
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND id = $4
        AND status = 'open'`,
    [
      input.tenantId,
      input.workflowId,
      input.workItemId,
      input.escalationId,
      nextStatus,
      input.resolutionAction,
      input.feedback,
      input.resolvedByType,
      input.resolvedById,
    ],
  );

  const openEscalations = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM workflow_subject_escalations
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND status = 'open'`,
    [input.tenantId, input.workflowId, input.workItemId],
  );
  if ((openEscalations.rows[0]?.count ?? 0) > 0) {
    return;
  }

  const shouldClearBlock =
    input.resolutionAction === 'unblock_subject' || input.resolutionAction === 'reopen_subject';
  await db.query(
    `UPDATE workflow_work_items
        SET escalation_status = NULL,
            blocked_state = CASE WHEN $4 THEN NULL ELSE blocked_state END,
            blocked_reason = CASE WHEN $4 THEN NULL ELSE blocked_reason END,
            next_expected_actor = CASE WHEN $5 THEN owner_role ELSE next_expected_actor END,
            next_expected_action = CASE WHEN $5 THEN 'rework' ELSE next_expected_action END,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3`,
    [
      input.tenantId,
      input.workflowId,
      input.workItemId,
      shouldClearBlock,
      input.resolutionAction === 'reopen_subject',
    ],
  );
}
