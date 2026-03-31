import type { DatabasePool } from '../../db/database.js';
import { TenantScopedRepository } from '../../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError } from '../../errors/domain-errors.js';
import { activeColumnId, parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import type { WorkflowActivationService } from '../workflow-activation/workflow-activation-service.js';
import { buildWorkflowReadColumns } from '../workflow-read-columns.js';
import type { ListWorkflowQuery } from '../workflow-service.types.js';
import { deriveWorkflowStageProjection } from '../workflow-stage/workflow-stage-projection.js';
import type { WorkItemService } from '../work-item-service.js';
import type { WorkflowStageResponse, WorkflowStageService } from '../workflow-stage/workflow-stage-service.js';
import {
  annotateBoardWorkItems,
  buildBoardStageSummary,
  buildWorkflowWorkItemSummary,
  hasWorkflowCancelRequest,
  isBoardItemOpen,
  readTerminalColumns,
} from './workflow-board.js';
import {
  asOptionalString,
  asRecord,
  normalizeWorkflowReadModel,
  readCount,
  sanitizeTaskReadModel,
  sanitizeWorkflowReadModel,
} from './workflow-read-model.js';
import {
  attachBlockedWorkItemCounts,
  attachWorkflowRelations,
} from './workflow-query-support.js';

export type WorkflowQueryDependencies = {
  activationService: Pick<WorkflowActivationService, 'listWorkflowActivations'>;
  pool: DatabasePool;
  stageService: Pick<WorkflowStageService, 'listStages'>;
  workItemService: Pick<WorkItemService, 'listWorkflowWorkItems'>;
};

export async function listWorkflows(
  pool: DatabasePool,
  tenantId: string,
  query: ListWorkflowQuery,
) {
  const conditions: string[] = [];
  const values: unknown[] = [tenantId];

  const exactFilters: Array<[string | undefined, string]> = [
    [query.workspace_id, 'w.workspace_id'],
    [query.playbook_id, 'w.playbook_id'],
  ];
  for (const [filter, column] of exactFilters) {
    if (!filter) continue;
    values.push(filter);
    conditions.push(`${column} = $${values.length}`);
  }

  if (query.state) {
    values.push(query.state.split(','));
    conditions.push(`w.state = ANY($${values.length}::workflow_state[])`);
  }

  const offset = (query.page - 1) * query.per_page;
  const whereClause = ['w.tenant_id = $1', ...conditions].join(' AND ');
  const limitPlaceholder = values.length + 1;
  const offsetPlaceholder = values.length + 2;

  const [total, rows] = await Promise.all([
    pool
      .query<{ total: string }>(
        `SELECT COUNT(*)::int AS total
           FROM workflows w
          WHERE ${whereClause}`,
        values,
      )
      .then((result) => Number(result.rows[0]?.total ?? '0')),
    pool.query<Record<string, unknown> & { tenant_id: string }>(
      `SELECT ${buildWorkflowReadColumns('w', { includeCurrentStage: false })},
              p.name AS workspace_name,
              pb.name AS playbook_name,
              pb.definition AS playbook_definition,
              COALESCE(task_counts.task_counts, '{}'::jsonb) AS task_counts,
              CASE
                WHEN w.lifecycle = 'planned'
                THEN stage_summary.current_stage_name
                ELSE NULL
              END AS current_stage,
              CASE
                WHEN w.playbook_id IS NULL THEN NULL
                ELSE jsonb_build_object(
                  'total_work_items', COALESCE(work_item_summary.total_work_items, 0),
                  'open_work_item_count', COALESCE(work_item_summary.open_work_item_count, 0),
                  'blocked_work_item_count', COALESCE(work_item_summary.blocked_work_item_count, 0),
                  'completed_work_item_count', COALESCE(work_item_summary.completed_work_item_count, 0),
                  'active_stage_count', CASE
                    WHEN w.lifecycle = 'ongoing'
                    THEN COALESCE(work_item_summary.active_stage_count, 0)
                    ELSE COALESCE(stage_summary.active_stage_count, COALESCE(work_item_summary.active_stage_count, 0))
                  END,
                  'awaiting_gate_count', COALESCE(stage_summary.awaiting_gate_count, 0),
                  'active_stage_names', CASE
                    WHEN w.lifecycle = 'ongoing'
                    THEN COALESCE(to_jsonb(work_item_summary.active_stage_names), '[]'::jsonb)
                    ELSE COALESCE(to_jsonb(stage_summary.active_stage_names), '[]'::jsonb)
                  END
                )
              END AS work_item_summary
         FROM workflows w
         LEFT JOIN workspaces p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.workspace_id
         LEFT JOIN playbooks pb
           ON pb.tenant_id = w.tenant_id
          AND pb.id = w.playbook_id
         LEFT JOIN LATERAL (
           SELECT jsonb_object_agg(task_state.state, task_state.total) AS task_counts
             FROM (
               SELECT state::text AS state, COUNT(*)::int AS total
                 FROM tasks
                WHERE tenant_id = w.tenant_id
                  AND workflow_id = w.id
                GROUP BY state
             ) AS task_state
         ) AS task_counts
           ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS total_work_items,
                  COUNT(*) FILTER (WHERE completed_at IS NULL)::int AS open_work_item_count,
                  COUNT(*) FILTER (WHERE completed_at IS NULL AND blocked_state = 'blocked')::int AS blocked_work_item_count,
                  COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed_work_item_count,
                  COUNT(DISTINCT stage_name) FILTER (WHERE completed_at IS NULL)::int AS active_stage_count,
                  ARRAY_REMOVE(
                    ARRAY_AGG(DISTINCT stage_name) FILTER (WHERE completed_at IS NULL),
                    NULL
                  ) AS active_stage_names
             FROM workflow_work_items wi
            WHERE wi.tenant_id = w.tenant_id
              AND wi.workflow_id = w.id
         ) AS work_item_summary
           ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (
                    WHERE gate_status = 'awaiting_approval'
                  )::int AS awaiting_gate_count,
                  ARRAY(
                    SELECT DISTINCT stage_name
                      FROM unnest(
                        COALESCE(work_item_summary.active_stage_names, '{}'::text[]) ||
                        COALESCE(
                          ARRAY_REMOVE(
                            ARRAY_AGG(DISTINCT ws.name) FILTER (
                              WHERE ws.gate_status IN ('awaiting_approval', 'changes_requested', 'rejected')
                            ),
                            NULL
                          ),
                          '{}'::text[]
                        )
                      ) AS stage_name
                     WHERE stage_name IS NOT NULL
                     ORDER BY stage_name
                  ) AS active_stage_names,
                  COALESCE(
                    cardinality(
                      ARRAY(
                        SELECT DISTINCT stage_name
                          FROM unnest(
                            COALESCE(work_item_summary.active_stage_names, '{}'::text[]) ||
                            COALESCE(
                              ARRAY_REMOVE(
                                ARRAY_AGG(DISTINCT ws.name) FILTER (
                                  WHERE ws.gate_status IN ('awaiting_approval', 'changes_requested', 'rejected')
                                ),
                                NULL
                              ),
                              '{}'::text[]
                            )
                          ) AS stage_name
                         WHERE stage_name IS NOT NULL
                      )
                    ),
                    0
                  )::int AS active_stage_count,
                  (
                    SELECT ws_active.name
                      FROM workflow_stages ws_active
                     WHERE ws_active.tenant_id = w.tenant_id
                       AND ws_active.workflow_id = w.id
                       AND ws_active.status IN ('active', 'awaiting_gate', 'blocked')
                     ORDER BY ws_active.position ASC
                     LIMIT 1
                  ) AS current_stage_name
             FROM workflow_stages ws
            WHERE ws.tenant_id = w.tenant_id
              AND ws.workflow_id = w.id
         ) AS stage_summary
           ON true
        WHERE ${whereClause}
        ORDER BY w.created_at DESC
        LIMIT $${limitPlaceholder}
       OFFSET $${offsetPlaceholder}`,
      [...values, query.per_page, offset],
    ),
  ]);

  const workflowsWithBlockedSummary = await attachBlockedWorkItemCounts(pool, tenantId, rows.rows);
  const workflowsWithRelations = await attachWorkflowRelations(pool, tenantId, workflowsWithBlockedSummary);
  return {
    data: workflowsWithRelations.map((workflow) =>
      normalizeWorkflowReadModel(sanitizeWorkflowReadModel(workflow)),
    ),
    meta: {
      total,
      page: query.page,
      per_page: query.per_page,
      pages: Math.ceil(total / query.per_page) || 1,
    },
  };
}

export async function getWorkflow(
  deps: WorkflowQueryDependencies,
  tenantId: string,
  workflowId: string,
): Promise<Record<string, unknown>> {
  const repo = new TenantScopedRepository(deps.pool, tenantId);
  const workflowRow = await repo.findById<Record<string, unknown> & { tenant_id: string }>(
    'workflows',
    buildWorkflowReadColumns(undefined, { includeCurrentStage: false }),
    workflowId,
  );
  if (!workflowRow) throw new NotFoundError('Workflow not found');

  const tasksRepo = new TenantScopedRepository(deps.pool, tenantId);
  const tasks = await tasksRepo.findAllPaginated<Record<string, unknown> & { tenant_id: string }>(
    'tasks',
    '*',
    ['workflow_id = $2'],
    [workflowId],
    'created_at ASC',
    1000,
    0,
  );

  if (!workflowRow.playbook_id) {
    const workflowWithRelations = await attachWorkflowRelations(deps.pool, tenantId, [workflowRow]);
    return {
      ...normalizeWorkflowReadModel(sanitizeWorkflowReadModel(workflowWithRelations[0])),
      tasks: tasks.map((task) => sanitizeTaskReadModel(task)),
    } as Record<string, unknown>;
  }

  const [workItems, activations, workflowStages, playbookDefinition] = await Promise.all([
    deps.workItemService.listWorkflowWorkItems(tenantId, workflowId),
    deps.activationService.listWorkflowActivations(tenantId, workflowId),
    deps.stageService.listStages(tenantId, workflowId),
    loadPlaybookDefinition(deps.pool, tenantId, String(workflowRow.playbook_id)),
  ]);
  const workflowWithRelations = await attachWorkflowRelations(deps.pool, tenantId, [workflowRow]);
  const workflowReadModel = {
    ...asRecord(workflowWithRelations[0]),
    playbook_definition: playbookDefinition,
  };
  const terminalColumns = readTerminalColumns(playbookDefinition);
  const projection = deriveWorkflowStageProjection({
    lifecycle: workflowRow.lifecycle === 'ongoing' ? 'ongoing' : 'planned',
    stageRows: workflowStages,
    openWorkItemStageNames: Array.from(
      new Set(
        workItems
          .filter((item) => isBoardItemOpen(item, terminalColumns))
          .map((item) => String(item.stage_name)),
      ),
    ),
    definition: playbookDefinition,
  });
  const normalizedWorkflow = normalizeWorkflowReadModel(
    sanitizeWorkflowReadModel(workflowReadModel),
    buildWorkflowWorkItemSummary(workItems, workflowStages, terminalColumns),
  );
  return {
    ...normalizedWorkflow,
    ...(workflowRow.lifecycle !== 'ongoing'
      ? {
          current_stage: projection.currentStage,
        }
      : {}),
    tasks: tasks.map((task) => sanitizeTaskReadModel(task)),
    work_items: workItems,
    activations,
    workflow_stages: workflowStages,
    active_stages: projection.activeStages,
  } as Record<string, unknown>;
}

export async function getWorkflowBoard(
  deps: WorkflowQueryDependencies,
  tenantId: string,
  workflowId: string,
) {
  const workflow = await getWorkflow(deps, tenantId, workflowId);
  if (!workflow.playbook_id) {
    throw new ConflictError('Board view is only available for playbook workflows');
  }
  const playbook = await deps.pool.query<{ definition: Record<string, unknown> }>(
    `SELECT p.definition
       FROM workflows w
       JOIN playbooks p
         ON p.tenant_id = w.tenant_id
        AND p.id = w.playbook_id
      WHERE w.tenant_id = $1
        AND w.id = $2`,
    [tenantId, workflowId],
  );
  if (!playbook.rowCount) {
    throw new NotFoundError('Playbook workflow not found');
  }
  const definition = parsePlaybookDefinition(playbook.rows[0].definition);
  const workItems = (workflow.work_items as Record<string, unknown>[]) ?? [];
  const workflowStages = Array.isArray(workflow.workflow_stages)
    ? (workflow.workflow_stages as WorkflowStageResponse[])
    : [];
  const terminalColumns = new Set(
    definition.board.columns
      .filter((column) => Boolean(column.is_terminal))
      .map((column) => String(column.id)),
  );
  const boardWorkItems = annotateBoardWorkItems(
    workItems,
    terminalColumns,
    activeColumnId(definition),
    asOptionalString(workflow.state) ?? null,
    hasWorkflowCancelRequest(asRecord(workflow.metadata)),
  );
  return {
    columns: definition.board.columns,
    work_items: boardWorkItems,
    active_stages: Array.isArray(workflow.active_stages) ? workflow.active_stages : [],
    awaiting_gate_count: readCount(asRecord(workflow.work_item_summary).awaiting_gate_count),
    stage_summary: buildBoardStageSummary(
      String(workflow.lifecycle ?? 'planned'),
      definition.stages,
      workflowStages,
      boardWorkItems,
      terminalColumns,
    ),
  };
}
async function loadPlaybookDefinition(pool: DatabasePool, tenantId: string, playbookId: string) {
  const result = await pool.query<{ definition: Record<string, unknown> }>(
    `SELECT definition
       FROM playbooks
      WHERE tenant_id = $1
        AND id = $2`,
    [tenantId, playbookId],
  );
  if (!result.rowCount) {
    throw new NotFoundError('Playbook workflow not found');
  }
  return result.rows[0].definition ?? {};
}
