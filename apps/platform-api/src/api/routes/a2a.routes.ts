import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';
import {
  buildA2ATaskResponse,
  buildA2AStreamEvent,
  buildAgentCard,
  mapA2ATaskToCreateInput,
} from '../../services/a2a-service.js';

const a2aTaskSchema = z.object({
  task: z.object({
    id: z.string().max(255).optional(),
    title: z.string().min(1).max(500),
    description: z.string().max(5000).optional(),
    type: z.string().max(64).optional(),
    priority: z.string().max(32).optional(),
    workflow_id: z.string().uuid().optional(),
    workspace_id: z.string().uuid().optional(),
    role: z.string().max(120).optional(),
    input: z.record(z.unknown()).optional(),
    context: z.record(z.unknown()).optional(),
    capabilities: z.array(z.string().min(1)).max(20).optional(),
    metadata: z.record(z.unknown()).optional(),
    requires_approval: z.boolean().optional(),
  }),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const a2aRoutes: FastifyPluginAsync = async (app) => {
  const taskService = app.taskService;

  app.get('/.well-known/agent.json', async (request) => {
    const protocol = request.protocol;
    const host = request.headers.host ?? 'localhost';
    return buildAgentCard(`${protocol}://${host}`);
  });

  app.post('/api/v1/a2a/tasks', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request, reply) => {
    const body = parseOrThrow(a2aTaskSchema.safeParse(request.body));
    const createdTask = await taskService.createTask(request.auth!, mapA2ATaskToCreateInput(body.task));
    return reply.status(201).send({ data: buildA2ATaskResponse(createdTask) });
  });

  app.get('/api/v1/a2a/tasks/:id', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const task = await taskService.getTask(request.auth!.tenantId, params.id);
    return { data: buildA2ATaskResponse(task) };
  });

  app.get('/api/v1/a2a/tasks/:id/events', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request, reply) => {
    const params = request.params as { id: string };
    await taskService.getTask(request.auth!.tenantId, params.id);

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.write(': connected\n\n');

    const unsubscribe = app.eventStreamService.subscribe(
      request.auth!.tenantId,
      { entityTypes: ['task'], entityId: params.id },
      (event) => {
        const normalized = buildA2AStreamEvent(event);
        reply.raw.write(`id: ${normalized.id}\n`);
        reply.raw.write(`event: ${normalized.event_type}\n`);
        reply.raw.write(`data: ${JSON.stringify(normalized)}\n\n`);
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
  });
};
