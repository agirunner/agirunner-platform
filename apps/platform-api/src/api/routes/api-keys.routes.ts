import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';
// ApiKeyService provided via app.apiKeyService

const createApiKeySchema = z.object({
  scope: z.enum(['agent', 'worker', 'admin']),
  owner_type: z.string().min(1).max(120),
  owner_id: z.string().uuid().optional(),
  label: z.string().max(255).optional(),
  expires_at: z.string().datetime(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const apiKeyRoutes: FastifyPluginAsync = async (app) => {
  const apiKeyService = app.apiKeyService;

  app.get('/api/v1/api-keys', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const data = await apiKeyService.listApiKeys(request.auth!.tenantId);
    return { data };
  });

  app.post('/api/v1/api-keys', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(createApiKeySchema.safeParse(request.body));
    const data = await apiKeyService.createApiKey(request.auth!, body);
    return reply.status(201).send({ data });
  });

  app.delete('/api/v1/api-keys/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const data = await apiKeyService.revokeApiKey(request.auth!, params.id);
    return { data };
  });
};
