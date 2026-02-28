import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';

function parseEventTypes(raw?: string): string[] | undefined {
  return raw?.split(',').map((value) => value.trim()).filter(Boolean);
}

async function streamEvents(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const query = request.query as { event_type?: string; project_id?: string; pipeline_id?: string };

  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.write(': connected\n\n');

  const authenticatedRequest = request as FastifyRequest & { auth?: { tenantId: string } };

  const unsubscribe = app.eventStreamService.subscribe(
    authenticatedRequest.auth!.tenantId,
    {
      types: parseEventTypes(query.event_type),
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
  app.get(app.config.EVENT_STREAM_PATH, auth, (request, reply) => streamEvents(app, request, reply));

  if (app.config.EVENT_STREAM_PATH !== '/api/v1/events/stream') {
    app.get('/api/v1/events/stream', auth, (request, reply) => streamEvents(app, request, reply));
  }
};
