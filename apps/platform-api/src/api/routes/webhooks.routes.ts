import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';

const registerSchema = z.object({
  url: z.string().url(),
  event_types: z.array(z.string().min(1)).default([]),
  secret: z.string().min(8).optional(),
});

const updateSchema = z
  .object({
    url: z.string().url().optional(),
    event_types: z.array(z.string().min(1)).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((value) => value.url !== undefined || value.event_types !== undefined || value.is_active !== undefined, {
    message: 'At least one field is required',
  });

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/webhooks', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(registerSchema.safeParse(request.body));
    const data = await app.webhookService.registerWebhook(request.auth!, body);
    return reply.status(201).send({ data });
  });

  app.patch('/api/v1/webhooks/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(updateSchema.safeParse(request.body));
    const data = await app.webhookService.updateWebhook(request.auth!.tenantId, params.id, body);
    return { data };
  });

  app.get('/api/v1/webhooks', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const data = await app.webhookService.listWebhooks(request.auth!.tenantId);
    return { data };
  });

  app.delete('/api/v1/webhooks/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const params = request.params as { id: string };
    await app.webhookService.deleteWebhook(request.auth!.tenantId, params.id);
    return reply.status(204).send();
  });
};
