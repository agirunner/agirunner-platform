import type { DatabasePool } from '../db/database.js';
import { ValidationError } from '../errors/domain-errors.js';
import { describeArtifactPreview } from './artifact-service.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';

const ARTIFACT_METADATA_SECRET_REDACTION = 'redacted://artifact-metadata-secret';
const MAX_FILTER_OPTIONS = 100;

export type WorkspaceArtifactExplorerSort =
  | 'newest'
  | 'oldest'
  | 'largest'
  | 'smallest'
  | 'name';

export interface WorkspaceArtifactExplorerListInput {
  q?: string;
  workflow_id?: string;
  work_item_id?: string;
  task_id?: string;
  stage_name?: string;
  role?: string;
  content_type?: string;
  preview_mode?: 'inline' | 'download';
  created_from?: string;
  created_to?: string;
  sort?: WorkspaceArtifactExplorerSort;
  page: number;
  per_page: number;
}

export interface WorkspaceArtifactExplorerRecord {
  id: string;
  workflow_id: string | null;
  task_id: string;
  logical_path: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
  metadata: Record<string, unknown>;
  workflow_name: string;
  workflow_state: string | null;
  work_item_id: string | null;
  work_item_title: string | null;
  stage_name: string | null;
  role: string | null;
  task_title: string;
  task_state: string;
  preview_eligible: boolean;
  preview_mode: 'text' | 'image' | 'pdf' | 'unsupported';
}

interface WorkspaceArtifactSummary {
  total_artifacts: number;
  previewable_artifacts: number;
  total_bytes: number;
  workflow_count: number;
  work_item_count: number;
  task_count: number;
  role_count: number;
}

interface WorkspaceArtifactWorkflowFilterOption {
  id: string;
  name: string;
}

interface WorkspaceArtifactWorkItemFilterOption {
  id: string;
  title: string;
  workflow_id: string | null;
  stage_name: string | null;
}

interface WorkspaceArtifactTaskFilterOption {
  id: string;
  title: string;
  workflow_id: string | null;
  work_item_id: string | null;
  stage_name: string | null;
}

interface WorkspaceArtifactExplorerMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_more: boolean;
  summary: WorkspaceArtifactSummary;
  filters: {
    workflows: WorkspaceArtifactWorkflowFilterOption[];
    work_items: WorkspaceArtifactWorkItemFilterOption[];
    tasks: WorkspaceArtifactTaskFilterOption[];
    stages: string[];
    roles: string[];
    content_types: string[];
  };
}

interface WorkspaceArtifactExplorerListResult {
  data: WorkspaceArtifactExplorerRecord[];
  meta: WorkspaceArtifactExplorerMeta;
}

interface WorkspaceArtifactExplorerRow {
  id: string;
  workflow_id: string | null;
  task_id: string;
  logical_path: string;
  content_type: string;
  size_bytes: number | string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  workflow_name: string;
  workflow_state: string | null;
  work_item_id: string | null;
  work_item_title: string | null;
  stage_name: string | null;
  role: string | null;
  task_title: string;
  task_state: string;
}

interface WorkspaceArtifactExplorerSummaryRow {
  total_artifacts: number | string | null;
  previewable_artifacts: number | string | null;
  total_bytes: number | string | null;
  workflow_count: number | string | null;
  work_item_count: number | string | null;
  task_count: number | string | null;
  role_count: number | string | null;
  workflows: unknown;
  work_items: unknown;
  tasks: unknown;
  stages: unknown;
  roles: unknown;
  content_types: unknown;
}

interface SqlFilters {
  sql: string;
  values: unknown[];
}

interface SqlFilterBuildOptions {
  firstFilterParameterIndex: number;
  previewMaxBytesIndex?: number;
}

export class WorkspaceArtifactExplorerService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly previewMaxBytes = 1024 * 1024,
  ) {}

  async listWorkspaceArtifacts(
    tenantId: string,
    workspaceId: string,
    input: WorkspaceArtifactExplorerListInput,
  ): Promise<WorkspaceArtifactExplorerListResult> {
    const usesPreviewFilter = input.preview_mode === 'inline' || input.preview_mode === 'download';
    const summaryFilters = buildFilterSql(input, {
      firstFilterParameterIndex: 4,
      previewMaxBytesIndex: 3,
    });
    const pageFilters = buildFilterSql(input, {
      firstFilterParameterIndex: usesPreviewFilter ? 4 : 3,
      ...(usesPreviewFilter ? { previewMaxBytesIndex: 3 } : {}),
    });
    const summaryParams = [
      tenantId,
      workspaceId,
      this.previewMaxBytes,
      ...summaryFilters.values,
      MAX_FILTER_OPTIONS,
    ];
    const pageParams = usesPreviewFilter
      ? [
          tenantId,
          workspaceId,
          this.previewMaxBytes,
          ...pageFilters.values,
          input.per_page,
          (input.page - 1) * input.per_page,
        ]
      : [
          tenantId,
          workspaceId,
          ...pageFilters.values,
          input.per_page,
          (input.page - 1) * input.per_page,
        ];

    const [summaryResult, pageResult] = await Promise.all([
      this.pool.query<WorkspaceArtifactExplorerSummaryRow>(
        buildSummaryQuery(summaryFilters.sql, summaryParams.length),
        summaryParams,
      ),
      this.pool.query<WorkspaceArtifactExplorerRow>(
        buildPageQuery(
          pageFilters.sql,
          buildOrderBySql(input.sort ?? 'newest'),
          pageParams.length - 1,
          pageParams.length,
        ),
        pageParams,
      ),
    ]);

    const summaryRow = summaryResult.rows[0];
    const summary = {
      total_artifacts: readInteger(summaryRow?.total_artifacts),
      previewable_artifacts: readInteger(summaryRow?.previewable_artifacts),
      total_bytes: readInteger(summaryRow?.total_bytes),
      workflow_count: readInteger(summaryRow?.workflow_count),
      work_item_count: readInteger(summaryRow?.work_item_count),
      task_count: readInteger(summaryRow?.task_count),
      role_count: readInteger(summaryRow?.role_count),
    };
    const totalPages = summary.total_artifacts === 0
      ? 1
      : Math.ceil(summary.total_artifacts / input.per_page);

    return {
      data: pageResult.rows.map((row) => mapArtifactRow(row, this.previewMaxBytes)),
      meta: {
        page: input.page,
        per_page: input.per_page,
        total: summary.total_artifacts,
        total_pages: totalPages,
        has_more: input.page < totalPages,
        summary,
        filters: {
          workflows: readWorkflowOptions(summaryRow?.workflows),
          work_items: readWorkItemOptions(summaryRow?.work_items),
          tasks: readTaskOptions(summaryRow?.tasks),
          stages: readStringArray(summaryRow?.stages),
          roles: readStringArray(summaryRow?.roles),
          content_types: readStringArray(summaryRow?.content_types),
        },
      },
    };
  }
}

function mapArtifactRow(
  row: WorkspaceArtifactExplorerRow,
  previewMaxBytes: number,
): WorkspaceArtifactExplorerRecord {
  const preview = describeArtifactPreview(
    row.content_type,
    readInteger(row.size_bytes),
    previewMaxBytes,
  );
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    task_id: row.task_id,
    logical_path: row.logical_path,
    content_type: row.content_type,
    size_bytes: readInteger(row.size_bytes),
    created_at: row.created_at.toISOString(),
    download_url: `/api/v1/tasks/${row.task_id}/artifacts/${row.id}`,
    metadata: sanitizeArtifactMetadata(row.metadata ?? {}),
    workflow_name: row.workflow_name,
    workflow_state: row.workflow_state,
    work_item_id: row.work_item_id,
    work_item_title: row.work_item_title,
    stage_name: row.stage_name,
    role: row.role,
    task_title: row.task_title,
    task_state: row.task_state,
    preview_eligible: preview.isPreviewEligible,
    preview_mode: preview.previewMode,
  };
}

function buildSummaryQuery(filterSql: string, facetLimitIndex: number): string {
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

function buildPageQuery(
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

function buildFilterSql(
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

  addEqualityCondition(
    conditions,
    values,
    'fa.workflow_id',
    input.workflow_id,
    options.firstFilterParameterIndex,
  );
  addEqualityCondition(
    conditions,
    values,
    't.work_item_id',
    input.work_item_id,
    options.firstFilterParameterIndex,
  );
  addEqualityCondition(
    conditions,
    values,
    'fa.task_id',
    input.task_id,
    options.firstFilterParameterIndex,
  );
  addEqualityCondition(
    conditions,
    values,
    'COALESCE(t.stage_name, wi.stage_name)',
    input.stage_name,
    options.firstFilterParameterIndex,
  );
  addEqualityCondition(
    conditions,
    values,
    't.role',
    input.role,
    options.firstFilterParameterIndex,
  );
  addEqualityCondition(
    conditions,
    values,
    'fa.content_type',
    input.content_type,
    options.firstFilterParameterIndex,
  );

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

function buildOrderBySql(sort: WorkspaceArtifactExplorerSort): string {
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

function buildPreviewEligibilitySql(alias: string, previewMaxBytesIndex: number): string {
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
  const rendered = boundary === 'start'
    ? `${value}T00:00:00.000Z`
    : `${value}T00:00:00.000Z`;
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

function sanitizeArtifactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return sanitizeSecretLikeRecord(metadata, {
    redactionValue: ARTIFACT_METADATA_SECRET_REDACTION,
  });
}

function readInteger(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function readWorkflowOptions(value: unknown): WorkspaceArtifactWorkflowFilterOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const candidate = asRecord(entry);
    const id = readString(candidate.id);
    const name = readString(candidate.name);
    if (!id || !name) {
      return [];
    }
    return [{ id, name }];
  });
}

function readWorkItemOptions(value: unknown): WorkspaceArtifactWorkItemFilterOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const candidate = asRecord(entry);
    const id = readString(candidate.id);
    const title = readString(candidate.title);
    if (!id || !title) {
      return [];
    }
    return [{
      id,
      title,
      workflow_id: readNullableString(candidate.workflow_id),
      stage_name: readNullableString(candidate.stage_name),
    }];
  });
}

function readTaskOptions(value: unknown): WorkspaceArtifactTaskFilterOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const candidate = asRecord(entry);
    const id = readString(candidate.id);
    const title = readString(candidate.title);
    if (!id || !title) {
      return [];
    }
    return [{
      id,
      title,
      workflow_id: readNullableString(candidate.workflow_id),
      work_item_id: readNullableString(candidate.work_item_id),
      stage_name: readNullableString(candidate.stage_name),
    }];
  });
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
