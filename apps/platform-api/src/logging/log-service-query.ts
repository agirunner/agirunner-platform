import type { DatabasePool } from '../db/database.js';
import {
  DEFAULT_PER_PAGE,
  MAX_PER_PAGE,
} from './log-service-constants.js';
import { decodeCursor, encodeCursor } from './log-service-cursor.js';
import { applyDefaultTimeBounds, applyLogFilters } from './log-service-filters.js';
import {
  LOG_FROM_SQL,
  LOG_SELECT_COLUMNS,
} from './log-service-sql.js';
import type {
  KeysetPage,
  LogFilters,
  LogRow,
} from './log-service-types.js';

export async function queryLogs(
  pool: DatabasePool,
  tenantId: string,
  filters: LogFilters,
): Promise<KeysetPage<LogRow>> {
  const perPage = Math.min(Math.max(filters.perPage ?? DEFAULT_PER_PAGE, 1), MAX_PER_PAGE);
  const order = filters.order === 'asc' ? 'ASC' : 'DESC';
  const comparator = order === 'DESC' ? '<' : '>';

  const conditions: string[] = ['l.tenant_id = $1'];
  const values: unknown[] = [tenantId];

  applyLogFilters(conditions, values, applyDefaultTimeBounds(filters));

  if (filters.cursor) {
    const { id, createdAt } = decodeCursor(filters.cursor);
    values.push(createdAt, id);
    conditions.push(`(l.created_at, l.id) ${comparator} ($${values.length - 1}, $${values.length})`);
  }

  values.push(perPage + 1);
  const whereClause = conditions.join(' AND ');
  const result = await pool.query<LogRow>(
    `SELECT ${LOG_SELECT_COLUMNS}
       ${LOG_FROM_SQL}
       WHERE ${whereClause}
       ORDER BY l.created_at ${order}, l.id ${order}
       LIMIT $${values.length}`,
    values,
  );

  const hasMore = result.rows.length > perPage;
  const data = hasMore ? result.rows.slice(0, perPage) : result.rows;
  const last = hasMore ? data[data.length - 1] : null;
  const nextCursor = last
    ? encodeCursor(String(last.id), last.cursor_created_at ?? last.created_at)
    : null;

  return {
    data,
    pagination: {
      per_page: perPage,
      has_more: hasMore,
      next_cursor: nextCursor,
      prev_cursor: filters.cursor ?? null,
    },
  };
}

export async function getLogById(
  pool: DatabasePool,
  tenantId: string,
  id: string,
): Promise<LogRow | null> {
  const result = await pool.query<LogRow>(
    `SELECT ${LOG_SELECT_COLUMNS}
         ${LOG_FROM_SQL}
        WHERE l.tenant_id = $1
          AND l.id = $2
        LIMIT 1`,
    [tenantId, id],
  );
  return result.rows[0] ?? null;
}

export async function* exportLogs(
  pool: DatabasePool,
  tenantId: string,
  filters: LogFilters,
): AsyncGenerator<LogRow> {
  let cursor: string | undefined = filters.cursor;
  const pageSize = Math.min(filters.perPage ?? DEFAULT_PER_PAGE, MAX_PER_PAGE);

  while (true) {
    const page = await queryLogs(pool, tenantId, { ...filters, cursor, perPage: pageSize });
    for (const row of page.data) {
      yield row;
    }
    if (!page.pagination.has_more || !page.pagination.next_cursor) {
      break;
    }
    cursor = page.pagination.next_cursor;
  }
}
