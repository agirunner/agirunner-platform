import { ValidationError } from '../../errors/domain-errors.js';
import type {
  SqlFilterBuildOptions,
  SqlFilters,
  WorkspaceArtifactExplorerListInput,
  WorkspaceArtifactExplorerSort,
} from './workspace-artifact-explorer-types.js';

export function buildSummaryQuery(filterSql: string, facetLimitIndex: number): string {
  return `
    WITH filtered AS (
      ${buildFilteredArtifactsQuery(filterSql)}
    )
    SELECT
      COUNT(*)::int AS total_artifacts,
      COUNT(*) FILTER (WHERE ${buildPreviewEligibilitySql('filtered', 3)})::int AS previewable_artifacts,
      COALESCE(SUM(size_bytes), 0)::bigint AS total_bytes,
      COUNT(DISTINCT workflow_id) FILTER (WHERE workflow_id IS NOT NULL)::int AS workflow_count,
      COUNT(DISTINCT work_item_id) FILTER (WHERE work_item_id IS NOT NULL)::int AS work_item_count,
      COUNT(DISTINCT task_id)::int AS task_count,
      COUNT(DISTINCT role) FILTER (WHERE role IS NOT NULL)::int AS role_count,
      COALESCE((
        SELECT json_agg(row_to_json(workflow_rows) ORDER BY workflow_rows.name ASC, workflow_rows.id ASC)
          FROM (
            SELECT DISTINCT workflow_id AS id, workflow_name AS name
              FROM filtered
             WHERE workflow_id IS NOT NULL
             ORDER BY name ASC, id ASC
             LIMIT $${facetLimitIndex}
          ) AS workflow_rows
      ), '[]'::json) AS workflows,
      COALESCE((
        SELECT json_agg(row_to_json(work_item_rows) ORDER BY work_item_rows.title ASC, work_item_rows.id ASC)
          FROM (
            SELECT DISTINCT work_item_id AS id, work_item_title AS title, workflow_id, stage_name
              FROM filtered
             WHERE work_item_id IS NOT NULL
             ORDER BY title ASC, id ASC
             LIMIT $${facetLimitIndex}
          ) AS work_item_rows
      ), '[]'::json) AS work_items,
      COALESCE((
        SELECT json_agg(row_to_json(task_rows) ORDER BY task_rows.title ASC, task_rows.id ASC)
          FROM (
            SELECT DISTINCT task_id AS id, task_title AS title, workflow_id, work_item_id, stage_name
              FROM filtered
             ORDER BY title ASC, id ASC
             LIMIT $${facetLimitIndex}
          ) AS task_rows
      ), '[]'::json) AS tasks,
      COALESCE((
        SELECT json_agg(stage_rows.value ORDER BY stage_rows.value ASC)
          FROM (
            SELECT DISTINCT stage_name AS value
              FROM filtered
             WHERE stage_name IS NOT NULL
             ORDER BY value ASC
             LIMIT $${facetLimitIndex}
          ) AS stage_rows
      ), '[]'::json) AS stages,
      COALESCE((
        SELECT json_agg(role_rows.value ORDER BY role_rows.value ASC)
          FROM (
            SELECT DISTINCT role AS value
              FROM filtered
             WHERE role IS NOT NULL
             ORDER BY value ASC
             LIMIT $${facetLimitIndex}
          ) AS role_rows
      ), '[]'::json) AS roles,
      COALESCE((
        SELECT json_agg(type_rows.value ORDER BY type_rows.value ASC)
          FROM (
            SELECT DISTINCT content_type AS value
              FROM filtered
             WHERE content_type IS NOT NULL
             ORDER BY value ASC
             LIMIT $${facetLimitIndex}
          ) AS type_rows
      ), '[]'::json) AS content_types
    FROM filtered
  `;
}

export function buildPageQuery(
  filterSql: string,
  orderBySql: string,
  limitIndex: number,
  offsetIndex: number,
): string {
  return `
    WITH filtered AS (
      ${buildFilteredArtifactsQuery(filterSql)}
    )
    SELECT *
      FROM filtered
     ORDER BY ${orderBySql}
     LIMIT $${limitIndex}
    OFFSET $${offsetIndex}
  `;
}

export function buildFilterSql(
  input: WorkspaceArtifactExplorerListInput,
  options: SqlFilterBuildOptions,
): SqlFilters {
  const values: unknown[] = [];
  const conditions: string[] = [];

  const createdFrom = parseDateBoundary(input.created_from, 'start');
  const createdToStart = parseDateBoundary(input.created_to, 'start');
  if (createdFrom && createdToStart && createdFrom > createdToStart) {
    throw new ValidationError('created_from must be on or before created_to');
  }
  const createdTo = parseDateBoundary(input.created_to, 'end');

  if (input.q?.trim()) {
    const pattern = `%${escapeLikePattern(input.q.trim())}%`;
    const parameter = pushSqlValue(values, pattern, options.firstFilterParameterIndex);
    conditions.push(`(
      fa.logical_path ILIKE $${parameter} ESCAPE '\\'
      OR COALESCE(fa.content_type, '') ILIKE $${parameter} ESCAPE '\\'
      OR COALESCE(w.name, '') ILIKE $${parameter} ESCAPE '\\'
      OR COALESCE(w.state::text, '') ILIKE $${parameter} ESCAPE '\\'
      OR COALESCE(t.title, '') ILIKE $${parameter} ESCAPE '\\'
      OR COALESCE(t.state::text, '') ILIKE $${parameter} ESCAPE '\\'
      OR COALESCE(t.role, '') ILIKE $${parameter} ESCAPE '\\'
      OR COALESCE(t.stage_name, wi.stage_name, '') ILIKE $${parameter} ESCAPE '\\'
      OR COALESCE(wi.title, '') ILIKE $${parameter} ESCAPE '\\'
    )`);
  }

  addEqualityCondition(conditions, values, 'fa.workflow_id', input.workflow_id, options.firstFilterParameterIndex);
  addEqualityCondition(conditions, values, 't.work_item_id', input.work_item_id, options.firstFilterParameterIndex);
  addEqualityCondition(conditions, values, 'fa.task_id', input.task_id, options.firstFilterParameterIndex);
  addEqualityCondition(
    conditions,
    values,
    'COALESCE(t.stage_name, wi.stage_name)',
    input.stage_name,
    options.firstFilterParameterIndex,
  );
  addEqualityCondition(conditions, values, 't.role', input.role, options.firstFilterParameterIndex);
  addEqualityCondition(conditions, values, 'fa.content_type', input.content_type, options.firstFilterParameterIndex);

  if (input.preview_mode === 'inline') {
    if (!options.previewMaxBytesIndex) {
      throw new ValidationError('preview_mode requires a preview byte limit parameter');
    }
    conditions.push(buildPreviewEligibilitySql('fa', options.previewMaxBytesIndex));
  }
  if (input.preview_mode === 'download') {
    if (!options.previewMaxBytesIndex) {
      throw new ValidationError('preview_mode requires a preview byte limit parameter');
    }
    conditions.push(`NOT (${buildPreviewEligibilitySql('fa', options.previewMaxBytesIndex)})`);
  }

  if (createdFrom) {
    const parameter = pushSqlValue(values, createdFrom.toISOString(), options.firstFilterParameterIndex);
    conditions.push(`fa.created_at >= $${parameter}::timestamptz`);
  }
  if (createdTo) {
    const parameter = pushSqlValue(values, createdTo.toISOString(), options.firstFilterParameterIndex);
    conditions.push(`fa.created_at < $${parameter}::timestamptz`);
  }

  return {
    sql: conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '',
    values,
  };
}

export function buildOrderBySql(sort: WorkspaceArtifactExplorerSort): string {
  if (sort === 'oldest') {
    return 'created_at ASC, id ASC';
  }
  if (sort === 'largest') {
    return 'size_bytes DESC, created_at DESC, id ASC';
  }
  if (sort === 'smallest') {
    return 'size_bytes ASC, created_at DESC, id ASC';
  }
  if (sort === 'name') {
    return "regexp_replace(logical_path, '^.*/', '') ASC, created_at DESC, id ASC";
  }
  return 'created_at DESC, id ASC';
}

export function buildPreviewEligibilitySql(alias: string, previewMaxBytesIndex: number): string {
  const contentType = `lower(split_part(COALESCE(${alias}.content_type, ''), ';', 1))`;
  return `(
    ${alias}.size_bytes <= $${previewMaxBytesIndex}
    AND (
      ${contentType} LIKE 'text/plain%'
      OR ${contentType} LIKE 'text/markdown%'
      OR ${contentType} LIKE 'text/csv%'
      OR ${contentType} LIKE 'application/json%'
      OR ${contentType} LIKE 'application/ld+json%'
      OR ${contentType} LIKE 'application/x-yaml%'
      OR ${contentType} LIKE 'application/yaml%'
      OR ${contentType} LIKE 'text/yaml%'
      OR ${contentType} LIKE 'image/%'
      OR ${contentType} LIKE 'application/pdf%'
    )
  )`;
}

function buildFilteredArtifactsQuery(filterSql: string): string {
  return `
    SELECT
      fa.id,
      fa.workflow_id,
      fa.task_id,
      fa.logical_path,
      NULLIF(BTRIM(fa.content_type), '') AS content_type,
      fa.size_bytes,
      fa.metadata,
      fa.created_at,
      COALESCE(NULLIF(BTRIM(w.name), ''), fa.workflow_id::text, 'Unscoped workflow') AS workflow_name,
      NULLIF(BTRIM(w.state::text), '') AS workflow_state,
      t.work_item_id,
      NULLIF(BTRIM(wi.title), '') AS work_item_title,
      NULLIF(BTRIM(COALESCE(t.stage_name, wi.stage_name)), '') AS stage_name,
      NULLIF(BTRIM(t.role), '') AS role,
      COALESCE(NULLIF(BTRIM(t.title), ''), t.id::text) AS task_title,
      COALESCE(NULLIF(BTRIM(t.state::text), ''), 'unknown') AS task_state
    FROM workflow_artifacts fa
    JOIN tasks t
      ON t.tenant_id = fa.tenant_id
     AND t.id = fa.task_id
    LEFT JOIN workflows w
      ON w.tenant_id = fa.tenant_id
     AND w.id = fa.workflow_id
    LEFT JOIN workflow_work_items wi
      ON wi.tenant_id = t.tenant_id
     AND wi.id = t.work_item_id
    WHERE fa.tenant_id = $1
      AND COALESCE(fa.workspace_id, t.workspace_id) = $2
      ${filterSql}
  `;
}

function addEqualityCondition(
  conditions: string[],
  values: unknown[],
  column: string,
  value: string | undefined,
  firstFilterParameterIndex = 3,
): void {
  if (!value?.trim()) {
    return;
  }
  const parameter = pushSqlValue(values, value.trim(), firstFilterParameterIndex);
  conditions.push(`${column} = $${parameter}`);
}

function pushSqlValue(values: unknown[], value: unknown, firstFilterParameterIndex: number): number {
  values.push(value);
  return values.length + firstFilterParameterIndex - 1;
}

function parseDateBoundary(
  value: string | undefined,
  boundary: 'start' | 'end',
): Date | null {
  if (!value?.trim()) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError('Date filters must use YYYY-MM-DD');
  }
  const rendered = `${value}T00:00:00.000Z`;
  const timestamp = Date.parse(rendered);
  if (Number.isNaN(timestamp)) {
    throw new ValidationError('Date filters must use valid calendar dates');
  }
  const parsed = new Date(timestamp);
  if (boundary === 'end') {
    parsed.setUTCDate(parsed.getUTCDate() + 1);
  }
  return parsed;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
