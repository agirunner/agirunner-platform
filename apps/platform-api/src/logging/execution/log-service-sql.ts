import type { LogStatsFilters } from './log-service-types.js';

export const ACTOR_KIND_SQL = `CASE
  WHEN l.actor_type IN ('worker', 'agent')
    AND (
      LOWER(COALESCE(l.role, '')) = 'orchestrator'
      OR COALESCE(l.is_orchestrator_task, false) = true
    ) THEN 'orchestrator_agent'
  WHEN l.actor_type = 'worker' THEN 'specialist_agent'
  WHEN l.actor_type = 'agent' THEN 'specialist_task_execution'
  WHEN l.actor_type IN ('operator', 'user', 'api_key', 'admin', 'service') THEN 'operator'
  WHEN l.actor_type = 'system' THEN 'platform_system'
  ELSE COALESCE(l.actor_type, 'platform_system')
END`;

const SEARCH_DOCUMENT_PARTS = [
  'l.operation',
  'l.task_id::text',
  'l.work_item_id::text',
  'l.activation_id::text',
  'l.workflow_id::text',
  'l.workspace_id::text',
  'l.stage_name',
  'l.trace_id::text',
  'l.span_id::text',
  'l.workflow_name',
  'l.workspace_name',
  'l.task_title',
  'l.role',
  'l.actor_type',
  'l.actor_id',
  'l.actor_name',
  'l.resource_type',
  'l.resource_name',
  "l.error->>'message'",
  "l.payload->>'system_prompt'",
  "l.payload->>'prompt_summary'",
  "l.payload->>'response_summary'",
  "l.payload->>'response_text'",
  "l.payload->>'tool_name'",
  'l.payload::text',
  "task_ctx.execution_environment_snapshot->>'name'",
  "task_ctx.execution_environment_snapshot->>'image'",
  "task_ctx.execution_environment_snapshot->>'resolved_image'",
  "task_ctx.execution_environment_snapshot->'verified_metadata'->>'distro'",
  "task_ctx.execution_environment_snapshot->'verified_metadata'->>'package_manager'",
];

export const SEARCH_DOCUMENT_SQL = `to_tsvector('simple', ${SEARCH_DOCUMENT_PARTS.map((part) => `COALESCE(${part}, '')`).join(
  " || ' ' ||\n  ",
)})`;

export const EXECUTION_ENVIRONMENT_SEARCH_SQL = `LOWER(
  COALESCE(task_ctx.execution_environment_snapshot->>'name', '') || ' ' ||
  COALESCE(task_ctx.execution_environment_snapshot->>'image', '') || ' ' ||
  COALESCE(task_ctx.execution_environment_snapshot->>'resolved_image', '') || ' ' ||
  COALESCE(task_ctx.execution_environment_snapshot->'verified_metadata'->>'distro', '') || ' ' ||
  COALESCE(task_ctx.execution_environment_snapshot->'verified_metadata'->>'package_manager', '')
)`;

export const LOG_SELECT_COLUMNS = `l.id, l.tenant_id, l.trace_id, l.span_id, l.parent_span_id,
            l.source, l.category, l.level, l.operation, l.status, l.duration_ms,
            l.payload, l.error,
            l.workspace_id, l.workflow_id, l.workflow_name, l.workspace_name, l.task_id,
            COALESCE(l.work_item_id, task_ctx.work_item_id) AS work_item_id,
            l.stage_name, l.activation_id, l.is_orchestrator_task,
            l.execution_backend, l.tool_owner,
            l.task_title,
            l.role,
            l.actor_type, l.actor_id, l.actor_name,
            l.resource_type, l.resource_id, l.resource_name,
            task_ctx.execution_environment_snapshot->>'id' AS execution_environment_id,
            task_ctx.execution_environment_snapshot->>'name' AS execution_environment_name,
            COALESCE(
              task_ctx.execution_environment_snapshot->>'image',
              task_ctx.execution_environment_snapshot->>'resolved_image'
            ) AS execution_environment_image,
            task_ctx.execution_environment_snapshot->'verified_metadata'->>'distro'
              AS execution_environment_distro,
            task_ctx.execution_environment_snapshot->'verified_metadata'->>'package_manager'
              AS execution_environment_package_manager,
            l.created_at,
            to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
              AS cursor_created_at`;

export const LOG_FROM_SQL = `FROM execution_logs l
       LEFT JOIN tasks task_ctx
         ON task_ctx.tenant_id = l.tenant_id
        AND task_ctx.id = l.task_id`;

const GROUP_BY_EXPRESSIONS: Record<LogStatsFilters['groupBy'], string> = {
  category: `COALESCE(l.category::text, 'unknown')`,
  operation: `COALESCE(l.operation, 'unknown')`,
  level: `COALESCE(l.level::text, 'unknown')`,
  task_id: `COALESCE(l.task_id::text, 'unassigned')`,
  work_item_id: `COALESCE(l.work_item_id::text, 'unassigned')`,
  stage_name: `COALESCE(l.stage_name, 'unassigned')`,
  activation_id: `COALESCE(l.activation_id::text, 'unassigned')`,
  is_orchestrator_task: `CASE WHEN l.is_orchestrator_task THEN 'orchestrator' ELSE 'task' END`,
  source: `COALESCE(l.source::text, 'unknown')`,
  execution_backend: `COALESCE(l.execution_backend::text, 'unknown')`,
  tool_owner: `COALESCE(l.tool_owner::text, 'unknown')`,
};

export function groupExpressionFor(column: LogStatsFilters['groupBy']): string {
  if (!(column in GROUP_BY_EXPRESSIONS)) {
    throw new Error(`Invalid group_by column: ${column}`);
  }
  return GROUP_BY_EXPRESSIONS[column];
}
