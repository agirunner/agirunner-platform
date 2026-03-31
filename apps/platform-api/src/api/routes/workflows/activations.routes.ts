import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../../errors/domain-errors.js';
import { buildAppliedMutationResult } from '../../../services/guided-closure/types.js';

const requestIdSchema = z.string().min(1).max(255);

const enqueueSchema = z.object({
  request_id: requestIdSchema,
  reason: z.string().min(1).max(2000),
  event_type: z.string().min(1).max(120),
  payload: z.record(z.unknown()).optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const workflowActivationRoutes: FastifyPluginAsync = async (app) => {
  const service = app.workflowActivationService;

  app.post('/api/v1/workflows/:id/activations', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(enqueueSchema.safeParse(request.body));
    const activation = await service.enqueue(request.auth!, params.id, body);
    return reply.status(201).send({ data: buildAppliedMutationResult(activation) });
  });

  app.get('/api/v1/workflows/:id/activations', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    return service.list(request.auth!.tenantId, params.id);
  });

  app.get('/api/v1/workflows/:id/activations/:activationId', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string; activationId: string };
    return service.get(request.auth!.tenantId, params.id, params.activationId);
  });
};
