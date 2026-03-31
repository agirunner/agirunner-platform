import type { DatabasePool } from '../../db/database.js';
import { asOptionalString, asRecord, readWorkflowIdArray } from './workflow-read-model.js';
import { buildWorkflowRelations } from './workflow-relations.js';

export async function attachWorkflowRelations(
  pool: DatabasePool,
  tenantId: string,
  workflows: Array<Record<string, unknown> & { tenant_id: string }>,
) {
  if (workflows.length === 0) {
    return workflows;
  }

  const parentIds = new Set<string>();
  const childIds = new Set<string>();
  const metadataByWorkflowId = new Map<string, Record<string, unknown>>();

  for (const workflow of workflows) {
    const metadata = asRecord(workflow.metadata);
    metadataByWorkflowId.set(String(workflow.id), metadata);
    const parentId = asOptionalString(metadata.parent_workflow_id);
    if (parentId) {
      parentIds.add(parentId);
    }
    for (const childId of readWorkflowIdArray(metadata.child_workflow_ids)) {
      childIds.add(childId);
    }
  }

  const referencedIds = Array.from(new Set([...parentIds, ...childIds]));
  const relatedById = new Map<string, Record<string, unknown>>();
  if (referencedIds.length > 0) {
    const relatedRes = await pool.query<Record<string, unknown>>(
      `SELECT w.id,
              w.name,
              w.state,
              w.playbook_id,
              w.created_at,
              w.started_at,
              w.completed_at,
              pb.name AS playbook_name
         FROM workflows w
         LEFT JOIN playbooks pb
           ON pb.tenant_id = w.tenant_id
          AND pb.id = w.playbook_id
        WHERE w.tenant_id = $1
          AND w.id = ANY($2::uuid[])`,
      [tenantId, referencedIds],
    );
    for (const row of relatedRes.rows) {
      relatedById.set(String(row.id), row);
    }
  }

  return workflows.map((workflow) => ({
    ...workflow,
    workflow_relations: buildWorkflowRelations(
      metadataByWorkflowId.get(String(workflow.id)) ?? {},
      relatedById,
    ),
  }));
}

export async function attachBlockedWorkItemCounts(
  pool: DatabasePool,
  tenantId: string,
  workflows: Array<Record<string, unknown> & { tenant_id: string }>,
) {
  if (workflows.length === 0) {
    return workflows;
  }

  const blockedCounts = await loadBlockedWorkItemCounts(
    pool,
    tenantId,
    workflows.map((workflow) => String(workflow.id)),
  );
  return workflows.map((workflow) => {
    const workItemSummary = asRecord(workflow.work_item_summary);
    if (Object.keys(workItemSummary).length === 0) {
      return workflow;
    }
    return {
      ...workflow,
      work_item_summary: {
        ...workItemSummary,
        blocked_work_item_count: blockedCounts.get(String(workflow.id)) ?? 0,
      },
    };
  });
}

async function loadBlockedWorkItemCounts(
  pool: DatabasePool,
  tenantId: string,
  workflowIds: string[],
) {
  if (workflowIds.length === 0) {
    return new Map<string, number>();
  }

  const result = await pool.query<{ workflow_id: string; blocked_work_item_count: number }>(
    `SELECT wi.workflow_id,
            COUNT(*) FILTER (
              WHERE wi.completed_at IS NULL
                AND (
                  COALESCE(assessment_rollup.blocking_assessment_count, 0) > 0
                  OR COALESCE(latest_gate.gate_status, '') IN ('changes_requested', 'rejected')
                )
            )::int AS blocked_work_item_count
       FROM workflow_work_items wi
       JOIN workflows w
         ON w.tenant_id = wi.tenant_id
        AND w.id = wi.workflow_id
       LEFT JOIN workflow_stages ws
         ON ws.tenant_id = wi.tenant_id
        AND ws.workflow_id = wi.workflow_id
        AND ws.name = wi.stage_name
       LEFT JOIN LATERAL (
         SELECT th.task_id AS subject_task_id,
                th.role AS subject_role,
                NULLIF(COALESCE(NULLIF(th.role_data->>'subject_revision', '')::int, 0), 0) AS subject_revision
           FROM task_handoffs th
          WHERE th.tenant_id = wi.tenant_id
            AND th.workflow_id = wi.workflow_id
            AND th.work_item_id = wi.id
            AND COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'
            AND th.completion = 'full'
          ORDER BY th.sequence DESC, th.created_at DESC
          LIMIT 1
       ) latest_delivery ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (
                  WHERE latest_assessment.decision_state IN ('request_changes', 'rejected')
                )::int AS blocking_assessment_count
           FROM (
             SELECT DISTINCT ON (assessment_task.role)
                    assessment_task.role,
                    COALESCE(latest_assessment_handoff.decision_state, latest_assessment_handoff.resolution) AS decision_state
               FROM tasks assessment_task
               LEFT JOIN LATERAL (
                 SELECT th.decision_state,
                        th.resolution
                   FROM task_handoffs th
                  WHERE th.tenant_id = assessment_task.tenant_id
                    AND th.workflow_id = assessment_task.workflow_id
                    AND th.task_id = assessment_task.id
                  ORDER BY th.sequence DESC, th.created_at DESC
                  LIMIT 1
               ) latest_assessment_handoff ON true
              WHERE assessment_task.tenant_id = wi.tenant_id
                AND assessment_task.workflow_id = wi.workflow_id
                AND COALESCE(assessment_task.metadata->>'task_kind', '') = 'assessment'
                AND COALESCE(assessment_task.metadata->>'subject_task_id', '') = COALESCE(latest_delivery.subject_task_id::text, '')
                AND COALESCE(NULLIF(assessment_task.metadata->>'subject_revision', '')::int, -1) = COALESCE(latest_delivery.subject_revision, -1)
              ORDER BY assessment_task.role,
                       assessment_task.created_at DESC,
                       assessment_task.id DESC
           ) latest_assessment
       ) assessment_rollup ON latest_delivery.subject_task_id IS NOT NULL
       LEFT JOIN LATERAL (
         SELECT g.status AS gate_status
           FROM workflow_stage_gates g
          WHERE g.tenant_id = wi.tenant_id
            AND g.workflow_id = wi.workflow_id
            AND g.stage_id = ws.id
          ORDER BY g.requested_at DESC, g.created_at DESC
          LIMIT 1
       ) latest_gate ON true
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = ANY($2::uuid[])
      GROUP BY wi.workflow_id`,
    [tenantId, workflowIds],
  );

  return new Map(
    result.rows.map((row) => [String(row.workflow_id), Number(row.blocked_work_item_count ?? 0)]),
  );
}
