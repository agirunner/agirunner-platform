import type { DatabasePool } from '../../../db/database.js';
import type { WorkflowRow } from './types.js';

export async function loadWorkflowRows(
  pool: DatabasePool,
  tenantId: string,
  input: {
    workflowIds?: string[];
    page?: number;
    perPage?: number;
    lifecycleFilter?: 'all' | 'ongoing' | 'planned';
    playbookId?: string;
    updatedWithin?: 'all' | '24h' | '7d' | '30d';
    search?: string;
    needsActionOnly?: boolean;
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
  const filterQuery = buildWorkflowListQuery(tenantId, input, {
    selectSql: ({ limitPlaceholder, needsActionWhereClause, offsetPlaceholder }) => `SELECT workflow_scope.id,
                           workflow_scope.name,
                           workflow_scope.state,
                           workflow_scope.lifecycle,
                           workflow_scope.current_stage,
                           workflow_scope.metadata,
                           workflow_scope.workspace_id,
                           workflow_scope.workspace_name,
                           workflow_scope.playbook_id,
                           workflow_scope.playbook_name,
                           workflow_scope.parameters,
                           workflow_scope.context,
                           workflow_scope.updated_at
                      FROM workflow_scope
                 LEFT JOIN task_summary
                        ON task_summary.workflow_id = workflow_scope.id::text
                 LEFT JOIN stage_summary
                        ON stage_summary.workflow_id = workflow_scope.id::text
                 LEFT JOIN work_item_summary
                        ON work_item_summary.workflow_id = workflow_scope.id::text
                 LEFT JOIN recovery_summary
                        ON recovery_summary.workflow_id = workflow_scope.id::text
                     ${needsActionWhereClause}
                  ORDER BY workflow_scope.updated_at DESC
                     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    offset,
    perPage,
  });
  const result = await pool.query<WorkflowRow>(filterQuery.sql, filterQuery.params);
  return result.rows;
}

export async function countWorkflowRows(
  pool: DatabasePool,
  tenantId: string,
  input: {
    lifecycleFilter?: 'all' | 'ongoing' | 'planned';
    playbookId?: string;
    updatedWithin?: 'all' | '24h' | '7d' | '30d';
    search?: string;
    needsActionOnly?: boolean;
  },
): Promise<number> {
  const query = buildWorkflowListQuery(tenantId, input, {
    selectSql: ({ needsActionWhereClause }) => `SELECT COUNT(*)::int AS total_count
                      FROM workflow_scope
                 LEFT JOIN task_summary
                        ON task_summary.workflow_id = workflow_scope.id::text
                 LEFT JOIN stage_summary
                        ON stage_summary.workflow_id = workflow_scope.id::text
                 LEFT JOIN work_item_summary
                        ON work_item_summary.workflow_id = workflow_scope.id::text
                 LEFT JOIN recovery_summary
                        ON recovery_summary.workflow_id = workflow_scope.id::text
                     ${needsActionWhereClause}`,
  });
  const result = await pool.query<{ total_count: number | string }>(query.sql, query.params);
  const rawTotal = result.rows[0]?.total_count;
  return typeof rawTotal === 'string' ? Number(rawTotal) : Number(rawTotal ?? 0);
}

interface WorkflowListFilterInput {
  lifecycleFilter?: 'all' | 'ongoing' | 'planned';
  playbookId?: string;
  updatedWithin?: 'all' | '24h' | '7d' | '30d';
  search?: string;
  needsActionOnly?: boolean;
}

function buildWorkflowListQuery(
  tenantId: string,
  input: WorkflowListFilterInput,
  options: {
    selectSql(input: {
      limitPlaceholder: string | null;
      needsActionWhereClause: string;
      offsetPlaceholder: string | null;
    }): string;
    perPage?: number;
    offset?: number;
  },
): { sql: string; params: unknown[] } {
  const builder = createSqlParamBuilder(tenantId);
  const whereClauses = buildWorkflowScopeWhereClauses(builder, input);
  const limitPlaceholder = options.perPage ? builder.add(options.perPage) : null;
  const offsetPlaceholder = options.offset !== undefined ? builder.add(options.offset) : null;
  const needsActionWhereClause = readNeedsActionWhereClause(input.needsActionOnly);

  const sql = `
    WITH workflow_scope AS (
      SELECT w.id,
             w.name,
             w.state,
             w.lifecycle,
             w.current_stage,
             w.metadata,
             w.workspace_id,
             ws.name AS workspace_name,
             w.playbook_id,
             pb.name AS playbook_name,
             w.parameters,
             w.context,
             w.updated_at
        FROM workflows w
        LEFT JOIN workspaces ws
          ON ws.tenant_id = w.tenant_id
         AND ws.id = w.workspace_id
        LEFT JOIN playbooks pb
          ON pb.tenant_id = w.tenant_id
         AND pb.id = w.playbook_id
       WHERE ${whereClauses.join('\n         AND ')}
    ),
    task_summary AS (
      SELECT workflow_id::text AS workflow_id,
             COUNT(*) FILTER (WHERE state IN ('awaiting_approval', 'output_pending_assessment'))::int AS waiting_for_decision_count,
             COUNT(*) FILTER (WHERE state = 'failed')::int AS failed_task_count
        FROM tasks
       WHERE tenant_id = $1
         AND workflow_id = ANY(ARRAY(SELECT id FROM workflow_scope))
         AND is_orchestrator_task = FALSE
       GROUP BY workflow_id
    ),
    active_specialist_work_items AS (
      SELECT workflow_id::text AS workflow_id,
             work_item_id::text AS work_item_id
        FROM tasks
       WHERE tenant_id = $1
         AND workflow_id = ANY(ARRAY(SELECT id FROM workflow_scope))
         AND work_item_id IS NOT NULL
         AND is_orchestrator_task = FALSE
         AND state IN ('ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment')
       GROUP BY workflow_id, work_item_id
    ),
    stage_summary AS (
      SELECT workflow_id::text AS workflow_id,
             COUNT(*) FILTER (WHERE gate_status = 'awaiting_approval')::int AS waiting_for_decision_count,
             COUNT(*) FILTER (WHERE gate_status IN ('blocked', 'changes_requested', 'rejected'))::int AS blocked_stage_count
        FROM workflow_stages
       WHERE tenant_id = $1
         AND workflow_id = ANY(ARRAY(SELECT id FROM workflow_scope))
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
             )::int AS blocked_work_item_count
        FROM workflow_work_items wi
        LEFT JOIN active_specialist_work_items
          ON active_specialist_work_items.workflow_id = wi.workflow_id::text
         AND active_specialist_work_items.work_item_id = wi.id::text
        LEFT JOIN workflow_stages ws
          ON ws.tenant_id = wi.tenant_id
         AND ws.workflow_id = wi.workflow_id
         AND ws.name = wi.stage_name
       WHERE wi.tenant_id = $1
         AND wi.workflow_id = ANY(ARRAY(SELECT id FROM workflow_scope))
       GROUP BY wi.workflow_id
    ),
    recovery_events AS (
      SELECT entity_id::text AS workflow_id,
             type,
             data
        FROM events
       WHERE tenant_id = $1
         AND entity_type = 'workflow'
         AND entity_id = ANY(ARRAY(SELECT id FROM workflow_scope))
      UNION ALL
      SELECT data->>'workflow_id' AS workflow_id,
             type,
             data
        FROM events
       WHERE tenant_id = $1
         AND data->>'workflow_id' = ANY(ARRAY(SELECT id::text FROM workflow_scope))
         AND NOT (
           entity_type = 'workflow'
           AND entity_id = ANY(ARRAY(SELECT id FROM workflow_scope))
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
    ${options.selectSql({
      limitPlaceholder,
      needsActionWhereClause,
      offsetPlaceholder,
    })}
  `;

  return { sql, params: builder.params };
}

function buildWorkflowScopeWhereClauses(
  builder: ReturnType<typeof createSqlParamBuilder>,
  input: WorkflowListFilterInput,
): string[] {
  const whereClauses = ['w.tenant_id = $1'];
  const lifecycleFilter = input.lifecycleFilter ?? 'all';
  if (lifecycleFilter !== 'all') {
    whereClauses.push(`w.lifecycle = ${builder.add(lifecycleFilter)}`);
  }
  if (input.playbookId) {
    whereClauses.push(`w.playbook_id = ${builder.add(input.playbookId)}`);
  }
  const updatedWithinWhereClause = readUpdatedWithinWhereClause(input.updatedWithin);
  if (updatedWithinWhereClause) {
    whereClauses.push(updatedWithinWhereClause);
  }
  const searchText = readSearchText(input.search);
  if (searchText) {
    const placeholder = builder.add(`%${searchText}%`);
    whereClauses.push(
      `(w.name ILIKE ${placeholder}
           OR COALESCE(ws.name, '') ILIKE ${placeholder}
           OR COALESCE(pb.name, '') ILIKE ${placeholder}
           OR w.id::text ILIKE ${placeholder})`,
    );
  }
  return whereClauses;
}

function readNeedsActionWhereClause(needsActionOnly: boolean | undefined): string {
  if (!needsActionOnly) {
    return '';
  }
  return `WHERE (
    (COALESCE(task_summary.waiting_for_decision_count, 0) + COALESCE(stage_summary.waiting_for_decision_count, 0)) > 0
    OR COALESCE(work_item_summary.open_escalation_count, 0) > 0
    OR (COALESCE(work_item_summary.blocked_work_item_count, 0) + COALESCE(stage_summary.blocked_stage_count, 0)) > 0
    OR COALESCE(task_summary.failed_task_count, 0) > 0
    OR COALESCE(recovery_summary.recoverable_issue_count, 0) > 0
  )`;
}

function createSqlParamBuilder(tenantId: string) {
  const params: unknown[] = [tenantId];
  return {
    params,
    add(value: unknown): string {
      params.push(value);
      return `$${params.length}`;
    },
  };
}

function readSearchText(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function readUpdatedWithinWhereClause(
  value: WorkflowListFilterInput['updatedWithin'],
): string | null {
  switch (value) {
    case '24h':
      return "w.updated_at >= NOW() - INTERVAL '24 hours'";
    case '7d':
      return "w.updated_at >= NOW() - INTERVAL '7 days'";
    case '30d':
      return "w.updated_at >= NOW() - INTERVAL '30 days'";
    default:
      return null;
  }
}
