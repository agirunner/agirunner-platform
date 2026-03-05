import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { ForbiddenError, SchemaValidationFailedError } from '../../errors/domain-errors.js';
import { EventService } from '../../services/event-service.js';
import { ensureWorkerAccess } from '../../services/worker-heartbeat-service.js';
import { TaskService } from '../../services/task-service.js';

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

const nextTaskSchema = z.object({
  agent_id: z.string().uuid().optional(),
  capabilities: z.array(z.string().min(1)).optional(),
  pipeline_id: z.string().uuid().optional(),
  include_context: z.boolean().optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const workerRoutes: FastifyPluginAsync = async (app) => {
  const taskService = new TaskService(app.pgPool, new EventService(app.pgPool), app.config, app.workerConnectionHub);

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

  const handleNextTask = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };
    ensureWorkerAccess(request.auth!, params.id);

    const body = parseOrThrow(nextTaskSchema.safeParse(request.body ?? {}));
    const worker = await app.workerService.getWorker(request.auth!.tenantId, params.id);

    let agentId = body.agent_id;
    if (agentId) {
      const suppliedAgent = await app.pgPool.query<{ worker_id: string | null }>(
        `SELECT worker_id
         FROM agents
         WHERE tenant_id = $1 AND id = $2`,
        [request.auth!.tenantId, agentId],
      );

      if (!suppliedAgent.rowCount) {
        throw new SchemaValidationFailedError('agent_id is invalid for the authenticated worker tenant.');
      }

      if (suppliedAgent.rows[0].worker_id !== params.id) {
        throw new ForbiddenError('Worker cannot claim tasks with an agent owned by a different worker.');
      }
    } else {
      const workerAgent = await app.pgPool.query<{ id: string }>(
        `SELECT id
         FROM agents
         WHERE tenant_id = $1 AND worker_id = $2
         ORDER BY created_at ASC
         LIMIT 1`,
        [request.auth!.tenantId, params.id],
      );

      if (!workerAgent.rowCount) {
        throw new SchemaValidationFailedError('Worker has no registered agent; provide agent_id explicitly.');
      }

      agentId = workerAgent.rows[0].id;
    }

    const claimed = await taskService.claimTask(request.auth!, {
      agent_id: agentId,
      worker_id: params.id,
      capabilities:
        body.capabilities ??
        (Array.isArray(worker.capabilities)
          ? worker.capabilities.map((capability: unknown) => String(capability))
          : []),
      pipeline_id: body.pipeline_id,
      include_context: body.include_context,
    });

    if (!claimed) {
      return reply.status(204).send();
    }

    return { data: claimed };
  };

  app.post('/api/v1/workers/:id/next', { preHandler: [authenticateApiKey, withScope('worker')] }, handleNextTask);
  app.post('/api/v1/workers/:id/tasks/next', { preHandler: [authenticateApiKey, withScope('worker')] }, handleNextTask);

  app.post('/api/v1/workers/:id/signal', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(signalSchema.safeParse(request.body));
    const data = await app.workerService.sendSignal(request.auth!, params.id, body);
    return { data };
  });
};
