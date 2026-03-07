import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';
import { EventService } from '../../services/event-service.js';
import { OrchestratorGrantService } from '../../services/orchestrator-grant-service.js';

const createGrantSchema = z.object({
  agent_id: z.string().uuid(),
  pipeline_id: z.string().uuid(),
  permissions: z.array(z.string().min(1)).min(1),
  expires_at: z.string().datetime().optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const orchestratorGrantRoutes: FastifyPluginAsync = async (app) => {
  const grantService = new OrchestratorGrantService(app.pgPool, new EventService(app.pgPool));

  app.post(
    '/api/v1/orchestrator-grants',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const body = parseOrThrow(createGrantSchema.safeParse(request.body));
      const grant = await grantService.createGrant(request.auth!, body);
      return reply.status(201).send({ data: grant });
    },
  );

  app.get(
    '/api/v1/orchestrator-grants',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const query = request.query as { pipeline_id?: string; agent_id?: string };
      return grantService.listGrants(request.auth!.tenantId, query);
    },
  );

  app.delete(
    '/api/v1/orchestrator-grants/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const result = await grantService.revokeGrant(request.auth!, params.id);
      return { data: result };
    },
  );
};
