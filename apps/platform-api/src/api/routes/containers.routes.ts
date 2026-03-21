import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';

const liveContainerSchema = z
  .object({
    container_id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    kind: z.enum(['orchestrator', 'runtime', 'task']),
    state: z.string().min(1).max(100),
    status: z.string().min(1).max(200),
    image: z.string().min(1).max(500),
    cpu_limit: z.string().min(1).max(50).optional(),
    memory_limit: z.string().min(1).max(50).optional(),
    started_at: z.string().datetime({ offset: true }).optional(),
    desired_state_id: z.string().uuid().optional(),
    runtime_id: z.string().min(1).max(200).optional(),
    task_id: z.string().uuid().optional(),
    workflow_id: z.string().uuid().optional(),
    role_name: z.string().min(1).max(200).optional(),
    playbook_id: z.string().min(1).max(200).optional(),
    playbook_name: z.string().min(1).max(200).optional(),
  })
  .strict();

const replaceLiveSnapshotSchema = z
  .object({
    containers: z.array(liveContainerSchema).max(500),
  })
  .strict();

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const containerRoutes: FastifyPluginAsync = async (app) => {
  const containerInventoryService = app.containerInventoryService;

  app.get(
    '/api/v1/fleet/live-containers',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({
      data: await containerInventoryService.listCurrentContainers(request.auth!.tenantId),
    }),
  );

  app.post(
    '/api/v1/fleet/live-containers',
    { preHandler: [authenticateApiKey, withScope('worker')] },
    async (request, reply) => {
      const body = parseOrThrow(replaceLiveSnapshotSchema.safeParse(request.body));
      await containerInventoryService.replaceLiveSnapshot(request.auth!.tenantId, body.containers);
      reply.status(204);
    },
  );
};
