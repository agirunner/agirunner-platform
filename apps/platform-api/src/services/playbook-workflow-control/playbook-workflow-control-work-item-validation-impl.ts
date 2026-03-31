
import type { DatabaseClient } from '../../db/database.js';
import { ValidationError } from '../../errors/domain-errors.js';
import type { WorkflowWorkItemRow } from './playbook-workflow-control-types.js';
import { readOptionalMetadataNumber } from './playbook-workflow-control-utils.js';

export async function assertWorkItemHasNoBlockingAssessmentResolutionImpl(this: any,
  tenantId: string,
  workflowId: string,
  workItemId: string,
  workItemTitle: string,
  db: DatabaseClient,
) {
  const result = await db.query<{ blocking_resolution: string | null }>(
    `SELECT latest_assessment.resolution AS blocking_resolution
       FROM LATERAL (
         SELECT th.task_id AS subject_task_id,
                NULLIF(COALESCE(NULLIF(th.role_data->>'subject_revision', '')::int, 0), 0) AS subject_revision
           FROM task_handoffs th
          WHERE th.tenant_id = $1
            AND th.workflow_id = $2
            AND th.work_item_id = $3
            AND th.completion = 'full'
            AND COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'
          ORDER BY th.sequence DESC, th.created_at DESC
          LIMIT 1
       ) latest_delivery
       JOIN LATERAL (
         SELECT assessment_handoff.resolution
           FROM (
             SELECT DISTINCT ON (th.role)
                    th.role,
                    th.resolution
               FROM task_handoffs th
              WHERE th.tenant_id = $1
                AND th.workflow_id = $2
                AND th.work_item_id = $3
                AND COALESCE(th.role_data->>'task_kind', '') = 'assessment'
                AND COALESCE(th.role_data->>'subject_task_id', '') = COALESCE(latest_delivery.subject_task_id::text, '')
                AND COALESCE(NULLIF(th.role_data->>'subject_revision', '')::int, -1) = COALESCE(latest_delivery.subject_revision, -1)
                AND th.resolution IN ('approved', 'request_changes', 'rejected', 'blocked')
              ORDER BY th.role, th.sequence DESC, th.created_at DESC
           ) assessment_handoff
          WHERE assessment_handoff.resolution IN ('request_changes', 'rejected', 'blocked')
          LIMIT 1
       ) latest_assessment ON true`,
    [tenantId, workflowId, workItemId],
  );
  const blockingResolution = result.rows[0]?.blocking_resolution;
  if (!blockingResolution) {
    return;
  }

  throw new ValidationError(
    `Cannot complete work item '${workItemTitle}' while it still has a blocking ${blockingResolution} assessment.`,
  );
}

export async function hasSatisfiedPendingHandoffImpl(this: any,
  tenantId: string,
  workflowId: string,
  workItem: Pick<WorkflowWorkItemRow, 'id' | 'next_expected_actor' | 'metadata'>,
  db: DatabaseClient,
) {
  const actor = workItem.next_expected_actor;
  if (!actor) {
    return false;
  }

  const subjectRevision = readOptionalMetadataNumber(workItem.metadata, 'subject_revision');
  if (subjectRevision === null) {
    const result = await db.query<{ satisfied_handoff: number }>(
      `SELECT 1 AS satisfied_handoff
         FROM task_handoffs th
        WHERE th.tenant_id = $1
          AND th.workflow_id = $2
          AND th.work_item_id = $3
          AND th.role = $4
          AND th.completion = 'full'
          AND COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'
        LIMIT 1`,
      [tenantId, workflowId, workItem.id, actor],
    );
    return result.rows.length > 0;
  }

  const result = await db.query<{ satisfied_handoff: number }>(
    `SELECT 1 AS satisfied_handoff
       FROM task_handoffs th
      WHERE th.tenant_id = $1
        AND th.workflow_id = $2
        AND th.work_item_id = $3
        AND th.role = $4
        AND th.completion = 'full'
        AND COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'
        AND COALESCE(NULLIF(th.role_data->>'subject_revision', '')::int, th.subject_revision, -1) = $5
      LIMIT 1`,
    [tenantId, workflowId, workItem.id, actor, subjectRevision],
  );
  return result.rows.length > 0;
}

export async function assertValidParentChangeImpl(this: any,
  tenantId: string,
  workflowId: string,
  workItemId: string,
  parentWorkItemId: string | null,
  db: DatabaseClient,
) {
  if (!parentWorkItemId) {
    return;
  }
  if (parentWorkItemId === workItemId) {
    throw new ValidationError('A work item cannot be its own parent');
  }

  const parentResult = await db.query<{ id: string }>(
    `SELECT id
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, parentWorkItemId],
  );
  if (!parentResult.rowCount) {
    throw new ValidationError('Parent work item not found');
  }

  const descendantResult = await db.query<{ id: string }>(
    `WITH RECURSIVE descendants AS (
       SELECT id
         FROM workflow_work_items
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
       UNION ALL
       SELECT wi.id
         FROM workflow_work_items wi
         JOIN descendants d
           ON wi.parent_work_item_id = d.id
        WHERE wi.tenant_id = $1
          AND wi.workflow_id = $2
     )
     SELECT id
       FROM descendants
      WHERE id = $4
      LIMIT 1`,
    [tenantId, workflowId, workItemId, parentWorkItemId],
  );
  if (descendantResult.rowCount) {
    throw new ValidationError('A work item cannot be reparented under one of its descendants');
  }
}
