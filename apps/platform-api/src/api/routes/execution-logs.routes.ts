import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { withRole } from '../../auth/rbac.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';
import type { LogStreamFilters } from '../../logging/log-stream-service.js';
import type { LogFilters, LogRow, LogStatsFilters } from '../../logging/log-service.js';

const validSources = ['runtime', 'container_manager', 'platform', 'task_container'] as const;
const validCategories = ['llm', 'tool', 'agent_loop', 'task_lifecycle', 'runtime_lifecycle', 'container', 'api', 'config', 'auth'] as const;
const validLevels = ['debug', 'info', 'warn', 'error'] as const;
const validStatuses = ['started', 'completed', 'failed', 'skipped'] as const;
const validGroupBy = ['category', 'operation', 'level', 'task_id', 'source'] as const;

const ingestEntrySchema = z.object({
  trace_id: z.string().uuid(),
  span_id: z.string().uuid(),
  parent_span_id: z.string().uuid().nullable().optional(),
  source: z.enum(validSources),
  category: z.enum(validCategories),
  level: z.enum(validLevels).default('info'),
  operation: z.string().min(1).max(500),
  status: z.enum(validStatuses),
  duration_ms: z.number().int().min(0).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  error: z
    .object({
      code: z.string().max(100).optional(),
      message: z.string().max(5000),
      stack: z.string().max(10000).optional(),
    })
    .nullable()
    .optional(),
  project_id: z.string().uuid().nullable().optional(),
  workflow_id: z.string().uuid().nullable().optional(),
  task_id: z.string().uuid().nullable().optional(),
  actor_type: z.string().max(50).optional(),
  actor_id: z.string().max(255).optional(),
  actor_name: z.string().max(255).optional(),
  resource_type: z.string().max(100).nullable().optional(),
  resource_id: z.string().uuid().nullable().optional(),
  resource_name: z.string().max(500).nullable().optional(),
  created_at: z.string().datetime().optional(),
});

const ingestSchema = z.object({
  entries: z.array(ingestEntrySchema).min(1).max(100),
});

function parseCsv(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const values = raw.split(',').map((v) => v.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) return result.data;
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const executionLogRoutes: FastifyPluginAsync = async (app) => {
  const logService = app.logService;
  const logStreamService = app.logStreamService;

  // --- Ingest (runtime/container-manager batch insert) ---

  app.post(
    '/api/v1/logs/ingest',
    { preHandler: [authenticateApiKey, withScope('worker')] },
    async (request, reply) => {
      const body = parseOrThrow(ingestSchema.safeParse(request.body));
      const result = await logService.insertBatch(
        body.entries.map((entry) => ({
          tenantId: request.auth!.tenantId,
          traceId: entry.trace_id,
          spanId: entry.span_id,
          parentSpanId: entry.parent_span_id ?? null,
          source: entry.source,
          category: entry.category,
          level: entry.level,
          operation: entry.operation,
          status: entry.status,
          durationMs: entry.duration_ms ?? null,
          metadata: entry.metadata,
          error: entry.error ?? null,
          projectId: entry.project_id ?? null,
          workflowId: entry.workflow_id ?? null,
          taskId: entry.task_id ?? null,
          actorType: entry.actor_type ?? null,
          actorId: entry.actor_id ?? null,
          actorName: entry.actor_name ?? null,
          resourceType: entry.resource_type ?? null,
          resourceId: entry.resource_id ?? null,
          resourceName: entry.resource_name ?? null,
          createdAt: entry.created_at ?? null,
        })),
      );
      reply.status(201);
      return { data: result };
    },
  );

  // --- Query (keyset-paginated) ---

  app.get(
    '/api/v1/logs',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const query = request.query as Record<string, string | undefined>;
      const filters: LogFilters = {
        projectId: query.project_id,
        workflowId: query.workflow_id,
        taskId: query.task_id,
        traceId: query.trace_id,
        source: parseCsv(query.source),
        category: parseCsv(query.category),
        level: query.level,
        operation: query.operation,
        status: parseCsv(query.status),
        actorId: query.actor_id,
        search: query.search,
        since: query.since,
        until: query.until,
        cursor: query.cursor,
        perPage: query.per_page ? Number(query.per_page) : undefined,
        order: query.order === 'asc' ? 'asc' : 'desc',
      };
      return logService.query(request.auth!.tenantId, filters);
    },
  );

  // --- Stream (SSE via PG LISTEN/NOTIFY) ---

  app.get(
    '/api/v1/logs/stream',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const filters: LogStreamFilters = {
        source: parseCsv(query.source),
        category: parseCsv(query.category),
        level: query.level,
        projectId: query.project_id,
        workflowId: query.workflow_id,
        taskId: query.task_id,
      };

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.write(': connected\n\n');

      const unsubscribe = logStreamService.subscribe(
        request.auth!.tenantId,
        filters,
        (entry) => {
          reply.raw.write(`event: log\n`);
          reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
        },
      );

      const keepAlive = setInterval(() => {
        reply.raw.write(`event: heartbeat\n`);
        reply.raw.write(`data: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
      }, app.config.EVENT_STREAM_KEEPALIVE_INTERVAL_MS);

      request.raw.on('close', () => {
        clearInterval(keepAlive);
        unsubscribe();
      });

      return reply;
    },
  );

  // --- Export (streamed JSON or CSV) ---

  app.get(
    '/api/v1/logs/export',
    { preHandler: [authenticateApiKey, withRole('operator')] },
    async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const format = query.format === 'csv' ? 'csv' : 'json';
      const filters: LogFilters = {
        projectId: query.project_id,
        workflowId: query.workflow_id,
        taskId: query.task_id,
        traceId: query.trace_id,
        source: parseCsv(query.source),
        category: parseCsv(query.category),
        level: query.level,
        operation: query.operation,
        status: parseCsv(query.status),
        actorId: query.actor_id,
        search: query.search,
        since: query.since,
        until: query.until,
        order: query.order === 'asc' ? 'asc' : 'desc',
      };

      const dateStr = new Date().toISOString().slice(0, 10);
      const contentType = format === 'csv' ? 'text/csv' : 'application/json';
      const ext = format === 'csv' ? 'csv' : 'json';

      reply.raw.setHeader('Content-Type', contentType);
      reply.raw.setHeader('Content-Disposition', `attachment; filename="logs-${dateStr}.${ext}"`);

      if (format === 'csv') {
        reply.raw.write(csvHeader() + '\n');
        for await (const row of logService.export(request.auth!.tenantId, filters)) {
          reply.raw.write(csvRow(row) + '\n');
        }
      } else {
        reply.raw.write('[\n');
        let first = true;
        for await (const row of logService.export(request.auth!.tenantId, filters)) {
          if (!first) reply.raw.write(',\n');
          reply.raw.write(JSON.stringify(row));
          first = false;
        }
        reply.raw.write('\n]\n');
      }

      reply.raw.end();
      return reply;
    },
  );

  // --- Stats (aggregations) ---

  app.get(
    '/api/v1/logs/stats',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const query = request.query as Record<string, string | undefined>;
      const groupBy = query.group_by ?? 'category';

      if (!validGroupBy.includes(groupBy as typeof validGroupBy[number])) {
        throw new SchemaValidationFailedError('Invalid group_by value', {
          allowed: validGroupBy,
        });
      }

      const filters: LogStatsFilters = {
        traceId: query.trace_id,
        workflowId: query.workflow_id,
        taskId: query.task_id,
        groupBy: groupBy as LogStatsFilters['groupBy'],
      };

      return { data: await logService.stats(request.auth!.tenantId, filters) };
    },
  );

  // --- Operations (dropdown data) ---

  app.get(
    '/api/v1/logs/operations',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const query = request.query as Record<string, string | undefined>;
      const since = query.since ? new Date(query.since) : new Date(Date.now() - 86400000);
      return { data: await logService.operations(request.auth!.tenantId, since, query.category) };
    },
  );

  // --- Actors (dropdown data) ---

  app.get(
    '/api/v1/logs/actors',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const query = request.query as Record<string, string | undefined>;
      const since = query.since ? new Date(query.since) : new Date(Date.now() - 86400000);
      return { data: await logService.actors(request.auth!.tenantId, since) };
    },
  );
};

const CSV_COLUMNS = [
  'id', 'created_at', 'source', 'category', 'level', 'operation', 'status',
  'duration_ms', 'project_id', 'workflow_id', 'task_id',
  'actor_type', 'actor_id', 'actor_name',
  'resource_type', 'resource_id', 'resource_name',
  'trace_id', 'span_id', 'error', 'metadata',
] as const;

function csvHeader(): string {
  return CSV_COLUMNS.join(',');
}

function csvRow(row: LogRow): string {
  const record = row as unknown as Record<string, unknown>;
  return CSV_COLUMNS.map((col) => {
    const val = record[col];
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') return csvEscape(JSON.stringify(val));
    return csvEscape(String(val));
  }).join(',');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
