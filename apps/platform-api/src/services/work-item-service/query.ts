import { NotFoundError } from '../../errors/domain-errors.js';
import type { DatabaseClient } from '../../db/database.js';
import { sanitizeSecretLikeValue } from '../secret-redaction.js';
import type {
  GetWorkflowWorkItemInput,
  GroupedWorkItemReadModel,
  ListWorkflowWorkItemsInput,
  WorkItemReadModel,
  WorkItemServiceDependencies,
} from './types.js';
import {
  asRecord,
  groupWorkItems,
  toWorkItemReadModel,
} from './shared.js';
import { workItemColumnList } from './types.js';

interface WorkItemMemoryEntry {
  [key: string]: unknown;
}

interface WorkItemMemoryHistoryEntry {
  [key: string]: unknown;
}

export async function listWorkflowWorkItems(
  deps: WorkItemServiceDependencies,
  tenantId: string,
  workflowId: string,
  input: ListWorkflowWorkItemsInput = {},
): Promise<WorkItemReadModel[] | GroupedWorkItemReadModel[]> {
  const workItems = await loadWorkflowWorkItems(deps.pool, tenantId, workflowId, input);
  return input.grouped ? groupWorkItems(workItems) : workItems;
}

export async function getWorkflowWorkItem(
  deps: WorkItemServiceDependencies,
  tenantId: string,
  workflowId: string,
  workItemId: string,
  input: GetWorkflowWorkItemInput = {},
): Promise<WorkItemReadModel | GroupedWorkItemReadModel> {
  const [workItem] = await loadWorkflowWorkItems(deps.pool, tenantId, workflowId, { work_item_id: workItemId });
  if (!workItem) {
    throw new NotFoundError('Workflow work item not found');
  }
  if (!input.include_children && workItem.children_count === 0) {
    return workItem;
  }
  const children = await loadWorkflowWorkItems(deps.pool, tenantId, workflowId, {
    parent_work_item_id: workItemId,
  });
  return {
    ...workItem,
    children,
  };
}

export async function listWorkItemTasks(
  deps: WorkItemServiceDependencies,
  tenantId: string,
  workflowId: string,
  workItemId: string,
) {
  await loadWorkItemContext(deps.pool, tenantId, workflowId, workItemId);
  const result = await deps.pool.query(
    `SELECT id,
            workflow_id,
            work_item_id,
            title,
            state,
            role,
            stage_name,
            activation_id,
            is_orchestrator_task,
            created_at,
            completed_at,
            depends_on
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
      ORDER BY created_at ASC`,
    [tenantId, workflowId, workItemId],
  );
  return result.rows.map((row) =>
    sanitizeSecretLikeValue(row, {
      redactionValue: 'redacted://work-item-secret',
      allowSecretReferences: false,
    }) as Record<string, unknown>,
  );
}

export async function listWorkItemEvents(
  deps: WorkItemServiceDependencies,
  tenantId: string,
  workflowId: string,
  workItemId: string,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  await loadWorkItemContext(deps.pool, tenantId, workflowId, workItemId);
  const result = await deps.pool.query(
    `SELECT *
       FROM events
      WHERE tenant_id = $1
        AND (
          (entity_type = 'work_item' AND entity_id = $2::uuid)
          OR (
            COALESCE(data->>'workflow_id', '') = $3
            AND COALESCE(data->>'work_item_id', '') = $4
          )
        )
      ORDER BY created_at DESC, id DESC
      LIMIT $5`,
    [tenantId, workItemId, workflowId, workItemId, limit],
  );
  return result.rows.map((row) =>
    sanitizeSecretLikeValue(row, {
      redactionValue: 'redacted://work-item-secret',
      allowSecretReferences: false,
    }) as Record<string, unknown>,
  );
}

export async function getWorkItemMemory(
  deps: WorkItemServiceDependencies,
  tenantId: string,
  workflowId: string,
  workItemId: string,
): Promise<{ entries: WorkItemMemoryEntry[] }> {
  const context = await loadWorkItemContext(deps.pool, tenantId, workflowId, workItemId);
  if (!context.workspace_id) {
    return { entries: [] };
  }

  const workspaceResult = await deps.pool.query<{ memory: unknown }>(
    `SELECT memory
       FROM workspaces
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1`,
    [tenantId, context.workspace_id],
  );

  const currentMemory = asRecord(workspaceResult.rows[0]?.memory);
  const entries = await deps.memoryScopeService.listWorkItemMemoryEntries({
    tenantId,
    workspaceId: context.workspace_id,
    workflowId,
    workItemId,
    currentMemory,
  });
  return { entries };
}

export async function getWorkItemMemoryHistory(
  deps: WorkItemServiceDependencies,
  tenantId: string,
  workflowId: string,
  workItemId: string,
  limit: number,
): Promise<{ history: WorkItemMemoryHistoryEntry[] }> {
  const context = await loadWorkItemContext(deps.pool, tenantId, workflowId, workItemId);
  if (!context.workspace_id) {
    return { history: [] };
  }

  const history = await deps.memoryScopeService.listWorkItemMemoryHistory({
    tenantId,
    workspaceId: context.workspace_id,
    workflowId,
    workItemId,
    limit,
  });
  return { history };
}

export async function loadWorkItemContext(
  pool: { query: DatabaseClient['query'] },
  tenantId: string,
  workflowId: string,
  workItemId: string,
) {
  const result = await pool.query<{ id: string; workflow_id: string; workspace_id: string | null }>(
    `SELECT wi.id, wi.workflow_id, w.workspace_id
       FROM workflow_work_items wi
       JOIN workflows w
         ON w.tenant_id = wi.tenant_id
        AND w.id = wi.workflow_id
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.id = $3
      LIMIT 1`,
    [tenantId, workflowId, workItemId],
  );
  if (!result.rowCount) {
    throw new NotFoundError('Workflow work item not found');
  }
  return result.rows[0];
}

export async function loadWorkflowWorkItems(
  pool: { query: DatabaseClient['query'] },
  tenantId: string,
  workflowId: string,
  input: ListWorkflowWorkItemsInput & { work_item_id?: string } = {},
) {
  const values: unknown[] = [tenantId, workflowId];
  const conditions = ['wi.tenant_id = $1', 'wi.workflow_id = $2'];

  if (input.work_item_id) {
    values.push(input.work_item_id);
    conditions.push(`wi.id = $${values.length}`);
  }
  if (input.parent_work_item_id) {
    values.push(input.parent_work_item_id);
    conditions.push(`wi.parent_work_item_id = $${values.length}`);
  }
  if (input.stage_name) {
    values.push(input.stage_name);
    conditions.push(`wi.stage_name = $${values.length}`);
  }
  if (input.column_id) {
    values.push(input.column_id);
    conditions.push(`wi.column_id = $${values.length}`);
  }

  const result = await pool.query(
    `SELECT ${workItemColumnList('wi')},
            branch.branch_status,
            COUNT(DISTINCT t.id)::int AS task_count,
            COUNT(DISTINCT child.id)::int AS children_count,
            COUNT(DISTINCT child.id) FILTER (WHERE child.completed_at IS NOT NULL)::int AS children_completed,
            latest_handoff.latest_handoff_completion,
            latest_handoff.latest_handoff_resolution,
            latest_handoff.unresolved_findings,
            latest_handoff.focus_areas,
            latest_handoff.known_risks,
            latest_delivery.subject_revision AS current_subject_revision,
            COALESCE(assessment_rollup.approved_assessment_count, 0)::int AS approved_assessment_count,
            COALESCE(assessment_rollup.blocking_assessment_count, 0)::int AS blocking_assessment_count,
            COALESCE(assessment_rollup.pending_assessment_count, 0)::int AS pending_assessment_count,
            CASE
              WHEN COALESCE(assessment_rollup.actual_assessment_count, 0) = 0 THEN NULL
              WHEN COALESCE(assessment_rollup.blocking_assessment_count, 0) > 0 THEN 'blocked'
              WHEN COALESCE(assessment_rollup.pending_assessment_count, 0) > 0 THEN 'pending'
              ELSE 'approved'
            END AS assessment_status,
            ws.gate_status AS stage_gate_status,
            latest_gate.gate_status,
            latest_gate.gate_decision_feedback,
            latest_gate.gate_decided_at
       FROM workflow_work_items wi
       LEFT JOIN tasks t
         ON t.tenant_id = wi.tenant_id
        AND t.work_item_id = wi.id
       LEFT JOIN workflow_work_items child
         ON child.tenant_id = wi.tenant_id
        AND child.parent_work_item_id = wi.id
       LEFT JOIN workflow_stages ws
         ON ws.tenant_id = wi.tenant_id
        AND ws.workflow_id = wi.workflow_id
        AND ws.name = wi.stage_name
       LEFT JOIN workflow_branches branch
         ON branch.tenant_id = wi.tenant_id
        AND branch.workflow_id = wi.workflow_id
        AND branch.id = wi.branch_id
       LEFT JOIN LATERAL (
         SELECT th.completion AS latest_handoff_completion,
                th.resolution AS latest_handoff_resolution,
                array_cat(
                  COALESCE(
                    ARRAY(SELECT jsonb_array_elements_text(COALESCE(th.remaining_items, '[]'::jsonb))),
                    ARRAY[]::text[]
                  ),
                  COALESCE(
                    ARRAY(SELECT jsonb_array_elements_text(COALESCE(th.blockers, '[]'::jsonb))),
                    ARRAY[]::text[]
                  )
                ) AS unresolved_findings,
                th.focus_areas,
                th.known_risks
           FROM task_handoffs th
          WHERE th.tenant_id = wi.tenant_id
            AND th.workflow_id = wi.workflow_id
            AND th.work_item_id = wi.id
          ORDER BY th.sequence DESC, th.created_at DESC
          LIMIT 1
       ) latest_handoff ON true
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
         SELECT COUNT(*) FILTER (WHERE latest_assessment.decision_state = 'approved')::int AS approved_assessment_count,
                COUNT(*) FILTER (WHERE latest_assessment.decision_state IN ('request_changes', 'rejected', 'blocked'))::int AS blocking_assessment_count,
                COUNT(*) FILTER (WHERE latest_assessment.decision_state IS NULL)::int AS pending_assessment_count,
                COUNT(*)::int AS actual_assessment_count
           FROM (
             SELECT DISTINCT ON (assessment_task.role)
                    assessment_task.role,
                    CASE
                      WHEN COALESCE(latest_assessment_handoff.decision_state, latest_assessment_handoff.resolution) IN ('approved', 'request_changes', 'rejected', 'blocked')
                        THEN COALESCE(latest_assessment_handoff.decision_state, latest_assessment_handoff.resolution)
                      ELSE NULL
                    END AS decision_state
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
         SELECT g.status AS gate_status,
                g.decision_feedback AS gate_decision_feedback,
                g.decided_at AS gate_decided_at
           FROM workflow_stage_gates g
          WHERE g.tenant_id = wi.tenant_id
            AND g.workflow_id = wi.workflow_id
            AND g.stage_id = ws.id
          ORDER BY g.requested_at DESC, g.created_at DESC
          LIMIT 1
       ) latest_gate ON true
      WHERE ${conditions.join(' AND ')}
      GROUP BY wi.id,
               latest_handoff.latest_handoff_completion,
               latest_handoff.latest_handoff_resolution,
               latest_handoff.unresolved_findings,
               latest_handoff.focus_areas,
               latest_handoff.known_risks,
               latest_delivery.subject_revision,
               assessment_rollup.approved_assessment_count,
               assessment_rollup.blocking_assessment_count,
               assessment_rollup.pending_assessment_count,
               assessment_rollup.actual_assessment_count,
               ws.gate_status,
               branch.branch_status,
               latest_gate.gate_status,
               latest_gate.gate_decision_feedback,
               latest_gate.gate_decided_at
      ORDER BY wi.created_at ASC`,
    values,
  );
  return result.rows.map(toWorkItemReadModel);
}
