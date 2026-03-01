import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';

const registerSchema = z.object({
  name: z.string().min(1).max(200),
  runtime_type: z.enum(['internal', 'openclaw', 'claude_code', 'codex', 'acp', 'custom', 'external']).optional(),
  connection_mode: z.enum(['websocket', 'sse', 'polling']).optional(),
  capabilities: z.array(z.string().min(1)).default([]),
  host_info: z.record(z.unknown()).optional(),
  heartbeat_interval_seconds: z.number().int().min(5).max(3600).optional(),
  metadata: z.record(z.unknown()).optional(),
  agents: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        capabilities: z.array(z.string().min(1)).default([]),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),
});

const heartbeatSchema = z.object({
  status: z.enum(['online', 'busy', 'draining', 'disconnected', 'offline']).optional(),
  current_task_id: z.string().uuid().nullable().optional(),
  current_tasks: z.array(z.string().uuid()).optional(),
  metrics: z.record(z.unknown()).optional(),
});

const signalSchema = z.object({
  type: z.enum(['cancel', 'drain', 'config_update']),
  task_id: z.string().uuid().optional(),
  data: z.record(z.unknown()).optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const workerRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/workers/register', { preHandler: [authenticateApiKey, withScope('worker')] }, async (request, reply) => {
    const body = parseOrThrow(registerSchema.safeParse(request.body));
    const data = await app.workerService.registerWorker(request.auth!, body);
    return reply.status(201).send({ data });
  });

  app.get('/api/v1/workers', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const data = await app.workerService.listWorkers(request.auth!.tenantId);
    return { data };
  });

  app.get('/api/v1/workers/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const data = await app.workerService.getWorker(request.auth!.tenantId, params.id);
    return { data };
  });

  app.delete('/api/v1/workers/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const params = request.params as { id: string };
    await app.workerService.deleteWorker(request.auth!, params.id);
    return reply.status(204).send();
  });

  app.post('/api/v1/workers/:id/heartbeat', { preHandler: [authenticateApiKey, withScope('worker')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(heartbeatSchema.safeParse(request.body));
    const data = await app.workerService.heartbeat(request.auth!, params.id, body);
    return { data };
  });

  app.post('/api/v1/workers/:id/signal', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(signalSchema.safeParse(request.body));
    const data = await app.workerService.sendSignal(request.auth!, params.id, body);
    return { data };
  });
};
