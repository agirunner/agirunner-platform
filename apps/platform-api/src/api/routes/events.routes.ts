import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../pagination.js';
import { ValidationError } from '../../errors/domain-errors.js';

function parseCsv(raw?: string): string[] | undefined {
  return raw?.split(',').map((value) => value.trim()).filter(Boolean);
}

async function streamEvents(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const query = request.query as {
    event_type?: string;
    entity_type?: string;
    entity_id?: string;
    project_id?: string;
    pipeline_id?: string;
  };

  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.write(': connected\n\n');

  const authenticatedRequest = request as FastifyRequest & { auth?: { tenantId: string } };

  const unsubscribe = app.eventStreamService.subscribe(
    authenticatedRequest.auth!.tenantId,
    {
      types: parseCsv(query.event_type),
      entityTypes: parseCsv(query.entity_type),
      entityId: query.entity_id,
      projectId: query.project_id,
      pipelineId: query.pipeline_id,
    },
    (event) => {
      reply.raw.write(`id: ${event.id}\n`);
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    },
  );

  const keepAlive = setInterval(() => {
    reply.raw.write(': ping\n\n');
  }, app.config.EVENT_STREAM_KEEPALIVE_INTERVAL_MS);

  request.raw.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });

  return reply;
}

export const eventRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [authenticateApiKey, withScope('agent')] };
  app.get('/api/v1/events', auth, async (request) => {
    const query = request.query as {
      event_type?: string;
      entity_type?: string;
      entity_id?: string;
      project_id?: string;
      pipeline_id?: string;
      page?: string;
      per_page?: string;
    };

    const page = Number(query.page ?? DEFAULT_PAGE);
    const perPage = Number(query.per_page ?? DEFAULT_PER_PAGE);
    if (!Number.isFinite(page) || page <= 0 || !Number.isFinite(perPage) || perPage <= 0 || perPage > MAX_PER_PAGE) {
      throw new ValidationError('Invalid pagination values');
    }

    const conditions = ['tenant_id = $1'];
    const values: unknown[] = [request.auth!.tenantId];

    const exactFilters: Array<[string | undefined, string]> = [
      [query.entity_type, 'entity_type'],
      [query.entity_id, 'entity_id'],
      [query.project_id, "COALESCE(data->>'project_id', '')"],
      [query.pipeline_id, "COALESCE(data->>'pipeline_id', '')"],
    ];

    exactFilters.forEach(([value, column]) => {
      if (!value) {
        return;
      }
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    });

    const eventTypes = parseCsv(query.event_type);
    if (eventTypes?.length) {
      values.push(eventTypes);
      conditions.push(`type = ANY($${values.length}::text[])`);
    }

    const offset = (page - 1) * perPage;
    const whereClause = conditions.join(' AND ');
    const totalResult = await app.pgPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM events WHERE ${whereClause}`,
      values,
    );
    values.push(perPage, offset);
    const rows = await app.pgPool.query(
      `SELECT *
       FROM events
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1}
       OFFSET $${values.length}`,
      values,
    );

    const total = Number(totalResult.rows[0]?.count ?? '0');
    return {
      data: rows.rows,
      meta: {
        total,
        page,
        per_page: perPage,
        pages: Math.ceil(total / perPage) || 1,
      },
    };
  });
  app.get(app.config.EVENT_STREAM_PATH, auth, (request, reply) => streamEvents(app, request, reply));

  if (app.config.EVENT_STREAM_PATH !== '/api/v1/events/stream') {
    app.get('/api/v1/events/stream', auth, (request, reply) => streamEvents(app, request, reply));
  }
};
