import type { DatabasePool, DatabaseQueryable } from '../db/database.js';
import { sanitizeSecretLikeValue } from '../services/secret-redaction.js';
import { LEVELS_AT_OR_ABOVE } from './log-levels.js';

export interface ExecutionLogEntry {
  tenantId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  source: 'runtime' | 'container_manager' | 'platform' | 'task_container';
  category:
    | 'llm'
    | 'tool'
    | 'agent_loop'
    | 'task_lifecycle'
    | 'runtime_lifecycle'
    | 'container'
    | 'api'
    | 'config'
    | 'auth';
  level: 'debug' | 'info' | 'warn' | 'error';
  operation: string;
  status: 'started' | 'completed' | 'failed' | 'skipped';
  durationMs?: number | null;
  payload?: Record<string, unknown>;
  error?: { code?: string; message: string; stack?: string } | null;
  workspaceId?: string | null;
  workflowId?: string | null;
  workflowName?: string | null;
  workspaceName?: string | null;
  taskId?: string | null;
  workItemId?: string | null;
  stageName?: string | null;
  activationId?: string | null;
  isOrchestratorTask?: boolean | null;
  taskTitle?: string | null;
  role?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  resourceName?: string | null;
  createdAt?: string | null;
}

export interface LogRow {
  id: string;
  tenant_id: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  source: string;
  category: string;
  level: string;
  operation: string;
  status: string;
  duration_ms: number | null;
  payload: Record<string, unknown>;
  error: { code?: string; message: string; stack?: string } | null;
  workspace_id: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  workspace_name: string | null;
  task_id: string | null;
  work_item_id: string | null;
  stage_name: string | null;
  activation_id: string | null;
  is_orchestrator_task: boolean;
  task_title: string | null;
  role: string | null;
  actor_type: string | null;
  actor_id: string | null;
  actor_name: string | null;
  resource_type: string | null;
  resource_id: string | null;
  resource_name: string | null;
  created_at: string;
}

export interface LogFilters {
  workspaceId?: string;
  workflowId?: string;
  taskId?: string;
  workItemId?: string;
  stageName?: string;
  activationId?: string;
  isOrchestratorTask?: boolean;
  traceId?: string;
  source?: string[];
  category?: string[];
  level?: string;
  operation?: string[];
  status?: string[];
  role?: string[];
  actorId?: string[];
  search?: string;
  since?: string;
  until?: string;
  cursor?: string;
  perPage?: number;
  order?: 'asc' | 'desc';
}

export interface LogStatsFilters {
  workspaceId?: string;
  traceId?: string;
  workflowId?: string;
  taskId?: string;
  workItemId?: string;
  stageName?: string;
  activationId?: string;
  isOrchestratorTask?: boolean;
  since?: string;
  until?: string;
  groupBy:
    | 'category'
    | 'operation'
    | 'level'
    | 'task_id'
    | 'work_item_id'
    | 'stage_name'
    | 'activation_id'
    | 'is_orchestrator_task'
    | 'source';
}

export interface LogStatsGroup {
  group: string;
  count: number;
  error_count: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  agg: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_cost_usd?: number;
  };
}

export interface LogStats {
  groups: LogStatsGroup[];
  totals: {
    count: number;
    error_count: number;
    total_duration_ms: number;
  };
}

export interface KeysetPage<T> {
  data: T[];
  pagination: {
    per_page: number;
    has_more: boolean;
    next_cursor: string | null;
    prev_cursor: string | null;
  };
}

export interface OperationCount {
  operation: string;
  count: number;
}

export interface LogBatchRejectionDetail {
  index: number;
  trace_id: string;
  operation: string;
  reason: string;
}

export interface ActorInfo {
  actor_type: string;
  actor_id: string;
  actor_name: string;
  count: number;
}

const DEFAULT_PER_PAGE = 100;
const MAX_PER_PAGE = 500;
const MAX_BATCH_SIZE = 100;
const MAX_REJECTION_DETAILS = 10;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(id: string, createdAt: string): string {
  return Buffer.from(JSON.stringify({ id, created_at: createdAt })).toString('base64url');
}

export function decodeCursor(cursor: string): { id: string; createdAt: string } {
  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
    id: string;
    created_at: string;
  };
  return { id: parsed.id, createdAt: parsed.created_at };
}

export interface LogLevelFilter {
  shouldWrite(tenantId: string, level: string): Promise<boolean>;
}

export class LogService {
  private levelFilter: LogLevelFilter | null = null;
  private readonly ensuredPartitionDates = new Set<string>();
  private readonly ensuringPartitionDates = new Map<string, Promise<void>>();
  constructor(private readonly pool: DatabasePool) {}

  /** Attach a write-side level filter. Entries below the tenant threshold are silently dropped. */
  setLevelFilter(filter: LogLevelFilter): void {
    this.levelFilter = filter;
  }

  async insert(entry: ExecutionLogEntry): Promise<void> {
    await this.insertWithExecutor(this.pool, entry);
  }

  async insertWithExecutor(
    executor: DatabaseQueryable,
    entry: ExecutionLogEntry,
  ): Promise<void> {
    if (this.levelFilter) {
      const shouldWrite = await this.levelFilter.shouldWrite(entry.tenantId, entry.level);
      if (!shouldWrite) return;
    }

    const partitionDate = partitionDateFor(entry.createdAt);
    await this.ensurePartition(partitionDate);

    const workflowName = entry.workflowName ?? null;
    const workspaceName = entry.workspaceName ?? null;
    const stageName = entry.stageName ?? null;

    try {
      await this.insertRow(executor, entry, workflowName, workspaceName, stageName);
    } catch (error) {
      if (!isMissingExecutionLogPartitionError(error)) {
        throw error;
      }
      this.ensuredPartitionDates.delete(partitionDate);
      await this.ensurePartition(partitionDate);
      await this.insertRow(executor, entry, workflowName, workspaceName, stageName);
    }
  }

  async insertBatch(entries: ExecutionLogEntry[]): Promise<{
    accepted: number;
    rejected: number;
    rejection_details: LogBatchRejectionDetail[];
  }> {
    if (entries.length === 0) return { accepted: 0, rejected: 0, rejection_details: [] };

    const batch = entries.slice(0, MAX_BATCH_SIZE);
    let accepted = 0;
    let rejected = 0;
    const rejectionDetails: LogBatchRejectionDetail[] = [];

    for (const [index, entry] of batch.entries()) {
      try {
        await this.insert(entry);
        accepted += 1;
      } catch (error) {
        rejected += 1;
        if (rejectionDetails.length < MAX_REJECTION_DETAILS) {
          rejectionDetails.push({
            index,
            trace_id: entry.traceId,
            operation: entry.operation,
            reason: formatBatchInsertError(error),
          });
        }
      }
    }

    return { accepted, rejected, rejection_details: rejectionDetails };
  }

  async query(tenantId: string, filters: LogFilters): Promise<KeysetPage<LogRow>> {
    const perPage = Math.min(Math.max(filters.perPage ?? DEFAULT_PER_PAGE, 1), MAX_PER_PAGE);
    const order = filters.order === 'asc' ? 'ASC' : 'DESC';
    const comparator = order === 'DESC' ? '<' : '>';

    const conditions: string[] = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];

    this.applyFilters(conditions, values, applyDefaultTimeBounds(filters));

    if (filters.cursor) {
      const { id, createdAt } = decodeCursor(filters.cursor);
      values.push(createdAt, id);
      conditions.push(`(created_at, id) ${comparator} ($${values.length - 1}, $${values.length})`);
    }

    const whereClause = conditions.join(' AND ');
    values.push(perPage + 1);

    const result = await this.pool.query<LogRow>(
      `SELECT id, tenant_id, trace_id, span_id, parent_span_id,
              source, category, level, operation, status, duration_ms,
              payload, error,
              workspace_id, workflow_id, workflow_name, workspace_name, task_id,
              work_item_id, stage_name, activation_id, is_orchestrator_task,
              task_title,
              role,
              actor_type, actor_id, actor_name,
              resource_type, resource_id, resource_name,
              created_at
       FROM execution_logs
       WHERE ${whereClause}
       ORDER BY created_at ${order}, id ${order}
       LIMIT $${values.length}`,
      values,
    );

    const hasMore = result.rows.length > perPage;
    const data = hasMore ? result.rows.slice(0, perPage) : result.rows;

    let nextCursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1];
      nextCursor = encodeCursor(String(last.id), last.created_at);
    }

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

  async getById(tenantId: string, id: string): Promise<LogRow | null> {
    const result = await this.pool.query<LogRow>(
      `SELECT id, tenant_id, trace_id, span_id, parent_span_id,
              source, category, level, operation, status, duration_ms,
              payload, error,
              workspace_id, workflow_id, workflow_name, workspace_name, task_id,
              work_item_id, stage_name, activation_id, is_orchestrator_task,
              task_title,
              role,
              actor_type, actor_id, actor_name,
              resource_type, resource_id, resource_name,
              created_at
         FROM execution_logs
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  async stats(tenantId: string, filters: LogStatsFilters): Promise<LogStats> {
    const groupExpression = groupExpressionFor(filters.groupBy);
    const conditions: string[] = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];

    this.applyStatsFilters(conditions, values, filters);

    const whereClause = conditions.join(' AND ');

    const result = await this.pool.query<{
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
        COUNT(*) FILTER (WHERE status = 'failed')::text AS error_count,
        SUM(duration_ms)::text AS total_duration_ms,
        AVG(duration_ms)::text AS avg_duration_ms,
        SUM((payload->>'input_tokens')::integer) FILTER (WHERE category = 'llm')::text AS total_input_tokens,
        SUM((payload->>'output_tokens')::integer) FILTER (WHERE category = 'llm')::text AS total_output_tokens,
        SUM((payload->>'cost_usd')::numeric) FILTER (WHERE category = 'llm')::text AS total_cost_usd
       FROM execution_logs
       WHERE ${whereClause}
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
      (acc, g) => ({
        count: acc.count + g.count,
        error_count: acc.error_count + g.error_count,
        total_duration_ms: acc.total_duration_ms + g.total_duration_ms,
      }),
      { count: 0, error_count: 0, total_duration_ms: 0 },
    );

    return { groups, totals };
  }

  async operations(tenantId: string, since: Date, category?: string): Promise<OperationCount[]> {
    const conditions: string[] = ['tenant_id = $1', 'created_at >= $2'];
    const values: unknown[] = [tenantId, since.toISOString()];

    if (category) {
      values.push(category);
      conditions.push(`category = $${values.length}`);
    }

    const whereClause = conditions.join(' AND ');
    const result = await this.pool.query<{ operation: string; count: string }>(
      `SELECT operation, COUNT(*)::text AS count
       FROM execution_logs
       WHERE ${whereClause}
       GROUP BY operation
       ORDER BY count DESC
       LIMIT 100`,
      values,
    );

    return result.rows.map((row) => ({
      operation: row.operation,
      count: Number(row.count),
    }));
  }

  async roles(tenantId: string, since: Date): Promise<{ role: string; count: number }[]> {
    const result = await this.pool.query<{ role: string; count: string }>(
      `SELECT role, COUNT(*)::text AS count
       FROM (
         SELECT role FROM execution_logs
         WHERE tenant_id = $1 AND created_at >= $2 AND role IS NOT NULL
         UNION ALL
         SELECT DISTINCT role FROM tasks
         WHERE tenant_id = $1 AND role IS NOT NULL AND role <> ''
       ) combined
       GROUP BY role
       ORDER BY count DESC
       LIMIT 50`,
      [tenantId, since.toISOString()],
    );

    return result.rows.map((row) => ({
      role: row.role,
      count: Number(row.count),
    }));
  }

  async actors(tenantId: string, since: Date): Promise<ActorInfo[]> {
    const result = await this.pool.query<{
      actor_type: string;
      actor_id: string;
      actor_name: string;
      count: string;
    }>(
      `SELECT actor_type, actor_id, actor_name, COUNT(*)::text AS count
       FROM execution_logs
       WHERE tenant_id = $1 AND created_at >= $2 AND actor_id IS NOT NULL
       GROUP BY actor_type, actor_id, actor_name
       ORDER BY count DESC
       LIMIT 100`,
      [tenantId, since.toISOString()],
    );

    return result.rows.map((row) => ({
      actor_type: row.actor_type,
      actor_id: row.actor_id,
      actor_name: row.actor_name,
      count: Number(row.count),
    }));
  }

  async *export(tenantId: string, filters: LogFilters): AsyncGenerator<LogRow> {
    let cursor: string | undefined = filters.cursor;
    const pageSize = Math.min(filters.perPage ?? DEFAULT_PER_PAGE, MAX_PER_PAGE);

    while (true) {
      const page = await this.query(tenantId, { ...filters, cursor, perPage: pageSize });
      for (const row of page.data) {
        yield row;
      }
      if (!page.pagination.has_more || !page.pagination.next_cursor) {
        break;
      }
      cursor = page.pagination.next_cursor;
    }
  }

  private async insertRow(
    executor: DatabaseQueryable,
    entry: ExecutionLogEntry,
    workflowName: string | null,
    workspaceName: string | null,
    stageName: string | null,
  ): Promise<void> {
    const payload = sanitizeLogValue(redactPayload(entry.payload) ?? {}) as Record<string, unknown>;
    const error = entry.error
      ? sanitizeLogValue(redactError(entry.error)) as { code?: string; message: string; stack?: string }
      : null;
    const resourceId = normalizeLogResourceId(entry.resourceId);
    const resourceName = normalizeLogResourceName(entry.resourceName, entry.resourceId, resourceId);

    await executor.query(
      `INSERT INTO execution_logs (
        tenant_id, trace_id, span_id, parent_span_id,
        source, category, level, operation, status, duration_ms,
        payload, error,
        workspace_id, workflow_id, workflow_name, workspace_name, task_id,
        work_item_id, activation_id, task_title, stage_name, is_orchestrator_task,
        role,
        actor_type, actor_id, actor_name,
        resource_type, resource_id, resource_name,
        created_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9, $10,
        $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22,
        $23,
        $24, $25, $26,
        $27, $28, $29,
        COALESCE($30::timestamptz, now())
      )`,
      [
        entry.tenantId,
        entry.traceId,
        entry.spanId,
        entry.parentSpanId ?? null,
        entry.source,
        entry.category,
        entry.level,
        sanitizeRequiredLogText(entry.operation),
        entry.status,
        entry.durationMs ?? null,
        JSON.stringify(payload),
        error ? JSON.stringify(error) : null,
        entry.workspaceId ?? null,
        entry.workflowId ?? null,
        sanitizeOptionalLogText(workflowName),
        sanitizeOptionalLogText(workspaceName),
        entry.taskId ?? null,
        entry.workItemId ?? null,
        entry.activationId ?? null,
        sanitizeOptionalLogText(entry.taskTitle),
        sanitizeOptionalLogText(stageName),
        entry.isOrchestratorTask ?? false,
        sanitizeOptionalLogText(entry.role),
        sanitizeOptionalLogText(entry.actorType),
        sanitizeOptionalLogText(entry.actorId),
        sanitizeOptionalLogText(entry.actorName),
        sanitizeOptionalLogText(entry.resourceType),
        resourceId,
        resourceName,
        entry.createdAt ?? null,
      ],
    );
  }

  private async ensurePartition(partitionDate: string): Promise<void> {
    if (this.ensuredPartitionDates.has(partitionDate)) {
      return;
    }
    const existing = this.ensuringPartitionDates.get(partitionDate);
    if (existing) {
      await existing;
      return;
    }

    const ensurePromise = this.createPartition(partitionDate);
    this.ensuringPartitionDates.set(partitionDate, ensurePromise);

    try {
      await ensurePromise;
      this.ensuredPartitionDates.add(partitionDate);
    } finally {
      this.ensuringPartitionDates.delete(partitionDate);
    }
  }

  private async createPartition(partitionDate: string): Promise<void> {
    try {
      await this.pool.query(`SELECT create_execution_logs_partition($1::date)`, [partitionDate]);
    } catch (error) {
      if (!isDuplicateExecutionLogPartitionError(error)) {
        throw error;
      }
    }
  }

  private applyFilters(conditions: string[], values: unknown[], filters: LogFilters): void {
    if (filters.workspaceId) {
      values.push(filters.workspaceId);
      conditions.push(`workspace_id = $${values.length}`);
    }
    if (filters.workflowId) {
      values.push(filters.workflowId);
      conditions.push(`workflow_id = $${values.length}`);
    }
    if (filters.taskId) {
      values.push(filters.taskId);
      conditions.push(`task_id = $${values.length}`);
    }
    if (filters.workItemId) {
      values.push(filters.workItemId);
      conditions.push(`work_item_id = $${values.length}`);
    }
    if (filters.stageName) {
      values.push(filters.stageName);
      conditions.push(`stage_name = $${values.length}`);
    }
    if (filters.activationId) {
      values.push(filters.activationId);
      conditions.push(`activation_id = $${values.length}`);
    }
    if (filters.isOrchestratorTask !== undefined) {
      values.push(filters.isOrchestratorTask);
      conditions.push(`is_orchestrator_task = $${values.length}`);
    }
    if (filters.traceId) {
      values.push(filters.traceId);
      conditions.push(`trace_id = $${values.length}`);
    }
    if (filters.source?.length) {
      values.push(filters.source);
      conditions.push(`source = ANY($${values.length}::execution_log_source[])`);
    }
    if (filters.category?.length) {
      values.push(filters.category);
      conditions.push(`category = ANY($${values.length}::execution_log_category[])`);
    }
    if (filters.level && LEVELS_AT_OR_ABOVE[filters.level]) {
      values.push(LEVELS_AT_OR_ABOVE[filters.level]);
      conditions.push(`level = ANY($${values.length}::execution_log_level[])`);
    }
    if (filters.operation?.length) {
      if (filters.operation.length === 1 && filters.operation[0].endsWith('*')) {
        values.push(filters.operation[0].slice(0, -1) + '%');
        conditions.push(`operation LIKE $${values.length}`);
      } else {
        values.push(filters.operation);
        conditions.push(`operation = ANY($${values.length}::text[])`);
      }
    }
    if (filters.status?.length) {
      values.push(filters.status);
      conditions.push(`status = ANY($${values.length}::execution_log_status[])`);
    }
    if (filters.role?.length) {
      values.push(filters.role);
      conditions.push(`role = ANY($${values.length}::text[])`);
    }
    if (filters.actorId?.length) {
      values.push(filters.actorId);
      conditions.push(`actor_id = ANY($${values.length}::text[])`);
    }
    if (filters.search) {
      const term = filters.search.trim();
      values.push(`%${term}%`);
      const p = values.length;
      const searchable =
        `CONCAT_WS(' ', operation, task_id, work_item_id, activation_id,` +
        ` workflow_id, workspace_id, stage_name, trace_id, span_id,` +
        ` actor_name, actor_id, task_title, payload::text)`;
      conditions.push(`${searchable} ILIKE $${p}`);
    }
    if (filters.since) {
      values.push(filters.since);
      conditions.push(`created_at >= $${values.length}`);
    }
    if (filters.until) {
      values.push(filters.until);
      conditions.push(`created_at <= $${values.length}`);
    }
  }

  private applyStatsFilters(
    conditions: string[],
    values: unknown[],
    filters: LogStatsFilters,
  ): void {
    if (filters.workspaceId) {
      values.push(filters.workspaceId);
      conditions.push(`workspace_id = $${values.length}`);
    }
    if (filters.traceId) {
      values.push(filters.traceId);
      conditions.push(`trace_id = $${values.length}`);
    }
    if (filters.workflowId) {
      values.push(filters.workflowId);
      conditions.push(`workflow_id = $${values.length}`);
    }
    if (filters.taskId) {
      values.push(filters.taskId);
      conditions.push(`task_id = $${values.length}`);
    }
    if (filters.workItemId) {
      values.push(filters.workItemId);
      conditions.push(`work_item_id = $${values.length}`);
    }
    if (filters.stageName) {
      values.push(filters.stageName);
      conditions.push(`stage_name = $${values.length}`);
    }
    if (filters.activationId) {
      values.push(filters.activationId);
      conditions.push(`activation_id = $${values.length}`);
    }
    if (filters.isOrchestratorTask !== undefined) {
      values.push(filters.isOrchestratorTask);
      conditions.push(`is_orchestrator_task = $${values.length}`);
    }
    if (filters.since) {
      values.push(filters.since);
      conditions.push(`created_at >= $${values.length}`);
    }
    if (filters.until) {
      values.push(filters.until);
      conditions.push(`created_at <= $${values.length}`);
    }
  }
}

const DEFAULT_TIME_BOUND_MS = 24 * 60 * 60 * 1000;

function applyDefaultTimeBounds(filters: LogFilters): LogFilters {
  if (filters.since || filters.until) {
    return filters;
  }
  return { ...filters, since: new Date(Date.now() - DEFAULT_TIME_BOUND_MS).toISOString() };
}

const GROUP_BY_EXPRESSIONS: Record<LogStatsFilters['groupBy'], string> = {
  category: `COALESCE(category::text, 'unknown')`,
  operation: `COALESCE(operation, 'unknown')`,
  level: `COALESCE(level::text, 'unknown')`,
  task_id: `COALESCE(task_id::text, 'unassigned')`,
  work_item_id: `COALESCE(work_item_id::text, 'unassigned')`,
  stage_name: `COALESCE(stage_name, 'unassigned')`,
  activation_id: `COALESCE(activation_id::text, 'unassigned')`,
  is_orchestrator_task: `CASE WHEN is_orchestrator_task THEN 'orchestrator' ELSE 'task' END`,
  source: `COALESCE(source::text, 'unknown')`,
};

const LOG_SECRET_REDACTION = '[REDACTED]';
const LOG_SECRET_REDACTION_OPTIONS = {
  redactionValue: LOG_SECRET_REDACTION,
  allowSecretReferences: false,
} as const;

function groupExpressionFor(column: LogStatsFilters['groupBy']): string {
  if (!(column in GROUP_BY_EXPRESSIONS)) {
    throw new Error(`Invalid group_by column: ${column}`);
  }
  return GROUP_BY_EXPRESSIONS[column];
}

const REDACT_EXEMPT_KEYS = new Set([
  'system_prompt',
  'prompt_summary',
  'response_summary',
  'description',
]);

const NON_SECRET_TOKEN_METRIC_KEYS = new Set([
  'tokens_in',
  'tokens_out',
  'total_tokens',
  'input_tokens',
  'output_tokens',
  'tokens_input',
  'tokens_output',
  'total_tokens_input',
  'total_tokens_output',
  'max_output_tokens',
]);

function redactPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) return {};
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    redacted[key] = redactValue(key, value);
  }
  return redacted;
}

function redactError(error: { code?: string; message: string; stack?: string }) {
  return {
    ...(error.code ? { code: error.code } : {}),
    message: redactString('message', error.message),
    ...(error.stack ? { stack: redactString('stack', error.stack) } : {}),
  };
}

function redactValue(key: string, value: unknown): unknown {
  if (REDACT_EXEMPT_KEYS.has(key) || NON_SECRET_TOKEN_METRIC_KEYS.has(key)) {
    return value;
  }
  if (isSecretLikeLogKey(key)) {
    return LOG_SECRET_REDACTION;
  }
  return sanitizeLogSecretValue(key, value);
}

function redactString(key: string, value: string): string {
  if (REDACT_EXEMPT_KEYS.has(key) || NON_SECRET_TOKEN_METRIC_KEYS.has(key)) {
    return value;
  }
  const redacted = sanitizeLogSecretValue(key, value);
  return typeof redacted === 'string' ? redacted : LOG_SECRET_REDACTION;
}

function sanitizeLogSecretValue(key: string, value: unknown): unknown {
  const sanitized = sanitizeSecretLikeValue({ [key]: value }, LOG_SECRET_REDACTION_OPTIONS) as Record<
    string,
    unknown
  >;
  return sanitized[key];
}

function isSecretLikeLogKey(key: string): boolean {
  return sanitizeLogSecretValue(key, 'present') === LOG_SECRET_REDACTION;
}

function sanitizeLogValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeRequiredLogText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    sanitized[key] = sanitizeLogValue(child);
  }
  return sanitized;
}

function sanitizeRequiredLogText(value: string): string {
  return value.replaceAll('\u0000', '');
}

function sanitizeOptionalLogText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return sanitizeRequiredLogText(value);
}

function normalizeLogResourceId(value: string | null | undefined): string | null {
  const sanitized = sanitizeOptionalLogText(value);
  if (!sanitized) {
    return null;
  }
  return UUID_PATTERN.test(sanitized) ? sanitized : null;
}

function normalizeLogResourceName(
  resourceName: string | null | undefined,
  resourceId: string | null | undefined,
  normalizedResourceId: string | null,
): string | null {
  const explicitName = sanitizeOptionalLogText(resourceName);
  if (explicitName) {
    return explicitName;
  }
  if (normalizedResourceId !== null) {
    return null;
  }
  return sanitizeOptionalLogText(resourceId);
}

function partitionDateFor(createdAt: string | null | undefined): string {
  const value = createdAt ? new Date(createdAt) : new Date();
  if (Number.isNaN(value.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

function isMissingExecutionLogPartitionError(error: unknown): boolean {
  const databaseError = getDatabaseErrorDetails(error);
  if (!databaseError) {
    return false;
  }
  return databaseError.message.includes('no partition of relation "execution_logs" found for row');
}

function isDuplicateExecutionLogPartitionError(error: unknown): boolean {
  const databaseError = getDatabaseErrorDetails(error);
  if (!databaseError) {
    return false;
  }
  return (
    databaseError.code === '42P07' ||
    databaseError.code === '42710' ||
    databaseError.message.includes('already exists')
  );
}

function getDatabaseErrorDetails(error: unknown): { message: string; code?: string } | null {
  if (error instanceof Error) {
    return { message: error.message, code: (error as Error & { code?: string }).code };
  }
  if (!error || typeof error !== 'object') {
    return null;
  }
  const message = typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message
    : null;
  if (!message) {
    return null;
  }
  const code = typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
  return { message, code };
}

function formatBatchInsertError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'unknown insert failure';
  }

  const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : null;
  const constraint =
    typeof (error as { constraint?: unknown }).constraint === 'string'
      ? (error as { constraint: string }).constraint
      : null;
  const message =
    typeof (error as { message?: unknown }).message === 'string'
      ? normalizeErrorMessage((error as { message: string }).message)
      : 'insert failed';

  if (code && constraint) {
    return `${message} (code=${code}, constraint=${constraint})`;
  }
  if (code) {
    return `${message} (code=${code})`;
  }
  return message;
}

function normalizeErrorMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 240);
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
