import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { sanitizeEventRow } from '../../services/event-service.js';
import {
  EventQueryService,
  parseCursorAfter,
  parseCursorLimit,
} from '../../services/event-query-service.js';

function parseCsv(raw?: string): string[] | undefined {
  return raw?.split(',').map((value) => value.trim()).filter(Boolean);
}

async function streamEvents(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const query = request.query as {
    event_type?: string;
    entity_type?: string;
    entity_id?: string;
    project_id?: string;
    workflow_id?: string;
    work_item_id?: string;
    stage_name?: string;
    activation_id?: string;
    gate_id?: string;
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
      workflowId: query.workflow_id,
      workItemId: query.work_item_id,
      stageName: query.stage_name,
      activationId: query.activation_id,
      gateId: query.gate_id,
    },
    (event) => {
      const publicEvent = sanitizeEventRow(event);
      reply.raw.write(`id: ${event.id}\n`);
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(publicEvent)}\n\n`);
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
  const eventQueryService = new EventQueryService(app.pgPool);

  app.get('/api/v1/events', auth, async (request) => {
    const query = request.query as {
      types?: string;
      event_type?: string;
      entity_type?: string;
      entity_id?: string;
      project_id?: string;
      workflow_id?: string;
      work_item_id?: string;
      stage_name?: string;
      activation_id?: string;
      gate_id?: string;
      after?: string;
      limit?: string;
    };

    return eventQueryService.listEvents({
      tenantId: request.auth!.tenantId,
      entityTypes: parseCsv(query.entity_type),
      entityId: query.entity_id,
      projectId: query.project_id,
      workflowId: query.workflow_id,
      workItemId: query.work_item_id,
      stageName: query.stage_name,
      activationId: query.activation_id,
      gateId: query.gate_id,
      eventTypes: parseCsv(query.types ?? query.event_type),
      after: parseCursorAfter(query.after),
      limit: parseCursorLimit(query.limit),
    });
  });
  app.get(app.config.EVENT_STREAM_PATH, auth, (request, reply) => streamEvents(app, request, reply));

  if (app.config.EVENT_STREAM_PATH !== '/api/v1/events/stream') {
    app.get('/api/v1/events/stream', auth, (request, reply) => streamEvents(app, request, reply));
  }
};
