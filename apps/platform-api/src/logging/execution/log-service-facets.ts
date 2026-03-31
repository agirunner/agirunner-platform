import type { DatabasePool } from '../../db/database.js';
import { applyDefaultTimeBounds, applyLogFilters, omitLogFilters } from './log-service-filters.js';
import { ACTOR_KIND_SQL, LOG_FROM_SQL } from './log-service-sql.js';
import type {
  ActorInfo,
  ActorKindValue,
  LogFilters,
  OperationCount,
  OperationValue,
  RoleValue,
  WorkflowValue,
} from './log-service-types.js';

export async function queryOperations(
  pool: DatabasePool,
  tenantId: string,
  filters: LogFilters,
): Promise<OperationCount[]> {
  const scoped = buildScopedWhereClause(tenantId, filters, ['operation']);
  const result = await pool.query<{ operation: string; count: string }>(
    `SELECT l.operation, COUNT(*)::text AS count
       ${LOG_FROM_SQL}
       WHERE ${scoped.whereClause}
       GROUP BY l.operation
       ORDER BY count DESC
       LIMIT 100`,
    scoped.values,
  );

  return result.rows.map((row) => ({
    operation: row.operation,
    count: Number(row.count),
  }));
}

export async function queryOperationValues(
  pool: DatabasePool,
  tenantId: string,
  filters: LogFilters,
): Promise<OperationValue[]> {
  const scoped = buildScopedWhereClause(tenantId, filters, ['operation'], [
    `l.operation IS NOT NULL`,
    `l.operation <> ''`,
  ]);
  const result = await pool.query<{ operation: string }>(
    `SELECT DISTINCT l.operation
       ${LOG_FROM_SQL}
       WHERE ${scoped.whereClause}
       ORDER BY l.operation
       LIMIT 100`,
    scoped.values,
  );

  return result.rows.map((row) => ({ operation: row.operation }));
}

export async function queryRoles(
  pool: DatabasePool,
  tenantId: string,
  filters: LogFilters,
): Promise<{ role: string; count: number }[]> {
  const scoped = buildScopedWhereClause(tenantId, filters, ['role'], [
    `l.role IS NOT NULL`,
    `l.role <> ''`,
  ]);
  const result = await pool.query<{ role: string; count: string }>(
    `SELECT l.role, COUNT(*)::text AS count
       ${LOG_FROM_SQL}
       WHERE ${scoped.whereClause}
       GROUP BY l.role
       ORDER BY count DESC
       LIMIT 50`,
    scoped.values,
  );

  return result.rows.map((row) => ({
    role: row.role,
    count: Number(row.count),
  }));
}

export async function queryRoleValues(
  pool: DatabasePool,
  tenantId: string,
  filters: LogFilters,
): Promise<RoleValue[]> {
  const scoped = buildScopedWhereClause(tenantId, filters, ['role'], [
    `l.role IS NOT NULL`,
    `l.role <> ''`,
  ]);
  const result = await pool.query<{ role: string }>(
    `SELECT DISTINCT l.role
       ${LOG_FROM_SQL}
       WHERE ${scoped.whereClause}
       ORDER BY l.role
       LIMIT 50`,
    scoped.values,
  );

  return result.rows.map((row) => ({ role: row.role }));
}

export async function queryActors(
  pool: DatabasePool,
  tenantId: string,
  filters: LogFilters,
): Promise<ActorInfo[]> {
  const scoped = buildScopedWhereClause(tenantId, filters, ['actorKind', 'actorType'], [
    'l.actor_type IS NOT NULL',
  ]);
  const result = await pool.query<{
    actor_kind: string;
    actor_id: string | null;
    actor_name: string | null;
    count: string;
    latest_role: string | null;
    latest_workflow_id: string | null;
    latest_workflow_name: string | null;
    latest_workflow_label: string | null;
  }>(
    `WITH filtered AS (
         SELECT
           ${ACTOR_KIND_SQL} AS actor_kind,
           l.role,
           l.workflow_id,
           l.workflow_name,
           l.created_at,
           l.id
         ${LOG_FROM_SQL}
         WHERE ${scoped.whereClause}
       ),
       actor_counts AS (
         SELECT
           actor_kind,
           COUNT(*)::text AS count
         FROM filtered
         GROUP BY actor_kind
       ),
       actor_latest AS (
         SELECT
           actor_kind,
           NULL::text AS actor_id,
           NULL::text AS actor_name,
           role AS latest_role,
           workflow_id::text AS latest_workflow_id,
           workflow_name AS latest_workflow_name,
           COALESCE(workflow_name, workflow_id::text) AS latest_workflow_label,
           ROW_NUMBER() OVER (
             PARTITION BY actor_kind
             ORDER BY created_at DESC, id DESC
           ) AS row_number
         FROM filtered
       )
       SELECT
         actor_counts.actor_kind,
         NULL::text AS actor_id,
         NULL::text AS actor_name,
         actor_counts.count,
         actor_latest.latest_role,
         actor_latest.latest_workflow_id,
         actor_latest.latest_workflow_name,
         actor_latest.latest_workflow_label
       FROM actor_counts
       LEFT JOIN actor_latest
         ON actor_latest.actor_kind = actor_counts.actor_kind
        AND actor_latest.row_number = 1
       ORDER BY actor_counts.count DESC
       LIMIT 100`,
    scoped.values,
  );

  return result.rows.map((row) => ({
    actor_kind: row.actor_kind,
    actor_id: row.actor_id,
    actor_name: row.actor_name,
    count: Number(row.count),
    latest_role: row.latest_role,
    latest_workflow_id: row.latest_workflow_id,
    latest_workflow_name: row.latest_workflow_name,
    latest_workflow_label: row.latest_workflow_label,
  }));
}

export async function queryActorKindValues(
  pool: DatabasePool,
  tenantId: string,
  filters: LogFilters,
): Promise<ActorKindValue[]> {
  const scoped = buildScopedWhereClause(tenantId, filters, ['actorKind', 'actorType'], [
    'l.actor_type IS NOT NULL',
  ]);
  const result = await pool.query<{ actor_kind: string }>(
    `SELECT DISTINCT ${ACTOR_KIND_SQL} AS actor_kind
       ${LOG_FROM_SQL}
       WHERE ${scoped.whereClause}
       ORDER BY actor_kind`,
    scoped.values,
  );

  return result.rows.map((row) => ({ actor_kind: row.actor_kind }));
}

export async function queryWorkflowValues(
  pool: DatabasePool,
  tenantId: string,
  filters: Pick<LogFilters, 'workspaceId'>,
): Promise<WorkflowValue[]> {
  const values: unknown[] = [tenantId];
  const conditions = ['w.tenant_id = $1'];

  if (filters.workspaceId) {
    values.push(filters.workspaceId);
    conditions.push(`w.workspace_id = $${values.length}`);
  }

  const result = await pool.query<{ id: string; name: string | null; workspace_id: string | null }>(
    `SELECT w.id, w.name, w.workspace_id
       FROM workflows w
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(NULLIF(TRIM(w.name), ''), w.id::text) ASC
      LIMIT 100`,
    values,
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    workspace_id: row.workspace_id,
  }));
}

function buildScopedWhereClause(
  tenantId: string,
  filters: LogFilters,
  omittedKeys: ReadonlyArray<keyof LogFilters>,
  baseConditions: string[] = [],
): { whereClause: string; values: unknown[] } {
  const conditions = ['l.tenant_id = $1', ...baseConditions];
  const values: unknown[] = [tenantId];
  applyLogFilters(conditions, values, omitLogFilters(applyDefaultTimeBounds(filters), omittedKeys));
  return { whereClause: conditions.join(' AND '), values };
}
