import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';

const registerSchema = z.object({
  name: z.string().min(1).max(200),
  protocol: z.enum(['rest', 'acp']).optional(),
  routing_tags: z.array(z.string().min(1)).default([]),
  execution_mode: z.enum(['specialist', 'orchestrator', 'hybrid']).optional(),
  tools: z
    .object({
      required: z.array(z.string().min(1)).optional(),
      optional: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  worker_id: z.string().uuid().optional(),
  heartbeat_interval_seconds: z.number().int().min(5).max(3600).optional(),
  metadata: z.record(z.unknown()).optional(),
  acp: z
    .object({
      transports: z.array(z.enum(['stdio', 'http', 'websocket'])).min(1).optional(),
      session_modes: z.array(z.enum(['run', 'session'])).min(1).optional(),
      capabilities: z.record(z.unknown()).optional(),
    })
    .optional(),
  profile: z.record(z.unknown()).optional(),
}).strict();

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const agentRoutes: FastifyPluginAsync = async (app) => {
  const agentService = app.agentService;

  app.post('/api/v1/agents/register', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request, reply) => {
    const body = parseOrThrow(registerSchema.safeParse(request.body));
    const agent = await agentService.registerAgent(request.auth!, body);
    return reply.status(201).send({ data: agent });
  });

  app.post('/api/v1/agents/:id/heartbeat', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const data = await agentService.heartbeat(request.auth!, params.id);
    return { data };
  });

  app.get('/api/v1/agents', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const agents = await agentService.listAgents(request.auth!.tenantId);
    return { data: agents };
  });
};
