import { LEVELS_AT_OR_ABOVE } from './log-levels.js';
import { DEFAULT_TIME_BOUND_MS } from './log-service-constants.js';
import {
  ACTOR_KIND_SQL,
  EXECUTION_ENVIRONMENT_SEARCH_SQL,
  SEARCH_DOCUMENT_SQL,
} from './log-service-sql.js';
import type { LogFilters } from './log-service-types.js';

export function applyDefaultTimeBounds(filters: LogFilters): LogFilters {
  if (filters.since || filters.until) {
    return filters;
  }
  return { ...filters, since: new Date(Date.now() - DEFAULT_TIME_BOUND_MS).toISOString() };
}

export function omitLogFilters(
  filters: LogFilters,
  keys: ReadonlyArray<keyof LogFilters>,
): LogFilters {
  const next = { ...filters };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

export function applyLogFilters(
  conditions: string[],
  values: unknown[],
  filters: LogFilters,
): void {
  if (filters.workspaceId) {
    values.push(filters.workspaceId);
    conditions.push(`l.workspace_id = $${values.length}`);
  }
  if (filters.workflowId) {
    values.push(filters.workflowId);
    conditions.push(`l.workflow_id = $${values.length}`);
  }
  if (filters.taskId) {
    values.push(filters.taskId);
    conditions.push(`l.task_id = $${values.length}`);
  }
  if (filters.workItemId) {
    values.push(filters.workItemId);
    conditions.push(`COALESCE(l.work_item_id, task_ctx.work_item_id) = $${values.length}`);
  }
  if (filters.stageName) {
    values.push(filters.stageName);
    conditions.push(`l.stage_name = $${values.length}`);
  }
  if (filters.activationId) {
    values.push(filters.activationId);
    conditions.push(`l.activation_id = $${values.length}`);
  }
  if (filters.isOrchestratorTask !== undefined) {
    values.push(filters.isOrchestratorTask);
    conditions.push(`l.is_orchestrator_task = $${values.length}`);
  }
  if (filters.traceId) {
    values.push(filters.traceId);
    conditions.push(`l.trace_id = $${values.length}`);
  }
  if (filters.executionBackend?.length) {
    values.push(filters.executionBackend);
    conditions.push(`l.execution_backend = ANY($${values.length}::execution_backend[])`);
  }
  if (filters.toolOwner?.length) {
    values.push(filters.toolOwner);
    conditions.push(`l.tool_owner = ANY($${values.length}::tool_owner[])`);
  }
  if (filters.source?.length) {
    values.push(filters.source);
    conditions.push(`l.source = ANY($${values.length}::execution_log_source[])`);
  }
  if (filters.category?.length) {
    values.push(filters.category);
    conditions.push(`l.category = ANY($${values.length}::execution_log_category[])`);
  }
  if (filters.level && LEVELS_AT_OR_ABOVE[filters.level]) {
    values.push(LEVELS_AT_OR_ABOVE[filters.level]);
    conditions.push(`l.level = ANY($${values.length}::execution_log_level[])`);
  }
  if (filters.operation?.length) {
    if (filters.operation.length === 1 && filters.operation[0].endsWith('*')) {
      values.push(filters.operation[0].slice(0, -1) + '%');
      conditions.push(`l.operation LIKE $${values.length}`);
    } else {
      values.push(filters.operation);
      conditions.push(`l.operation = ANY($${values.length}::text[])`);
    }
  }
  if (filters.status?.length) {
    values.push(filters.status);
    conditions.push(`l.status = ANY($${values.length}::execution_log_status[])`);
  }
  if (filters.role?.length) {
    values.push(filters.role);
    conditions.push(`l.role = ANY($${values.length}::text[])`);
  }
  if (filters.actorKind?.length) {
    values.push(filters.actorKind);
    conditions.push(`${ACTOR_KIND_SQL} = ANY($${values.length}::text[])`);
  }
  if (filters.actorType?.length) {
    values.push(filters.actorType);
    conditions.push(`l.actor_type = ANY($${values.length}::text[])`);
  }
  if (filters.actorId?.length) {
    values.push(filters.actorId);
    conditions.push(`l.actor_id = ANY($${values.length}::text[])`);
  }
  if (filters.executionEnvironment) {
    values.push(`%${filters.executionEnvironment.trim().toLowerCase()}%`);
    conditions.push(`${EXECUTION_ENVIRONMENT_SEARCH_SQL} LIKE $${values.length}`);
  }
  if (filters.search) {
    values.push(filters.search.trim());
    conditions.push(`${SEARCH_DOCUMENT_SQL} @@ websearch_to_tsquery('simple', $${values.length})`);
  }
  if (filters.since) {
    values.push(filters.since);
    conditions.push(`l.created_at >= $${values.length}`);
  }
  if (filters.until) {
    values.push(filters.until);
    conditions.push(`l.created_at <= $${values.length}`);
  }
}
