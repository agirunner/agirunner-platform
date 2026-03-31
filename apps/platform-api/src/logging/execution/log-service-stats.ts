import type { DatabasePool } from '../../db/database.js';
import { applyDefaultTimeBounds, applyLogFilters } from './log-service-filters.js';
import { groupExpressionFor, LOG_FROM_SQL } from './log-service-sql.js';
import type {
  LogStats,
  LogStatsFilters,
  LogStatsGroup,
} from './log-service-types.js';

export async function queryLogStats(
  pool: DatabasePool,
  tenantId: string,
  filters: LogStatsFilters,
): Promise<LogStats> {
  const groupExpression = groupExpressionFor(filters.groupBy);
  const conditions: string[] = ['l.tenant_id = $1'];
  const values: unknown[] = [tenantId];
  const { groupBy: _groupBy, ...queryFilters } = filters;
  applyLogFilters(
    conditions,
    values,
    applyDefaultTimeBounds(queryFilters),
  );

  const result = await pool.query<{
    group_key: string | null;
    count: string;
    error_count: string;
    total_duration_ms: string | null;
    avg_duration_ms: string | null;
    total_input_tokens: string | null;
    total_output_tokens: string | null;
    total_cost_usd: string | null;
  }>(
    `SELECT
        ${groupExpression} AS group_key,
        COUNT(*)::text AS count,
        COUNT(*) FILTER (WHERE l.status = 'failed')::text AS error_count,
        SUM(l.duration_ms)::text AS total_duration_ms,
        AVG(l.duration_ms)::text AS avg_duration_ms,
        SUM((l.payload->>'input_tokens')::integer) FILTER (WHERE l.category = 'llm')::text AS total_input_tokens,
        SUM((l.payload->>'output_tokens')::integer) FILTER (WHERE l.category = 'llm')::text AS total_output_tokens,
        SUM((l.payload->>'cost_usd')::numeric) FILTER (WHERE l.category = 'llm')::text AS total_cost_usd
       ${LOG_FROM_SQL}
       WHERE ${conditions.join(' AND ')}
       GROUP BY ${groupExpression}
       ORDER BY count DESC`,
    values,
  );

  const groups: LogStatsGroup[] = result.rows.map((row) => ({
    group: row.group_key ?? 'unknown',
    count: Number(row.count),
    error_count: Number(row.error_count),
    total_duration_ms: Number(row.total_duration_ms ?? 0),
    avg_duration_ms: Math.round(Number(row.avg_duration_ms ?? 0)),
    agg: buildAgg(row),
  }));

  const totals = groups.reduce(
    (acc, group) => ({
      count: acc.count + group.count,
      error_count: acc.error_count + group.error_count,
      total_duration_ms: acc.total_duration_ms + group.total_duration_ms,
    }),
    { count: 0, error_count: 0, total_duration_ms: 0 },
  );

  return { groups, totals };
}

function buildAgg(row: {
  total_input_tokens: string | null;
  total_output_tokens: string | null;
  total_cost_usd: string | null;
}): LogStatsGroup['agg'] {
  const agg: LogStatsGroup['agg'] = {};
  if (row.total_input_tokens !== null) {
    agg.total_input_tokens = Number(row.total_input_tokens);
  }
  if (row.total_output_tokens !== null) {
    agg.total_output_tokens = Number(row.total_output_tokens);
  }
  if (row.total_cost_usd !== null) {
    agg.total_cost_usd = Number(row.total_cost_usd);
  }
  return agg;
}
