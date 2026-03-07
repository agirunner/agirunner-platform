import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';

const registerSchema = z.object({
  kind: z.literal('webhook'),
  pipeline_id: z.string().uuid().optional(),
  subscriptions: z.array(z.string().min(1)).default([]),
  config: z.object({
    url: z.string().url(),
    secret: z.string().min(8).optional(),
    headers: z.record(z.string()).optional(),
  }),
});

const updateSchema = z
  .object({
    subscriptions: z.array(z.string().min(1)).optional(),
    is_active: z.boolean().optional(),
    config: z
      .object({
        url: z.string().url().optional(),
        secret: z.string().min(8).optional(),
        headers: z.record(z.string()).optional(),
      })
      .optional(),
  })
  .refine(
    (value) =>
      value.subscriptions !== undefined || value.is_active !== undefined || value.config !== undefined,
    { message: 'At least one field is required' },
  );

const actionSchema = z.object({
  feedback: z.string().min(1).max(4000).optional(),
  reason: z.string().min(1).max(4000).optional(),
  override_input: z.record(z.unknown()).optional(),
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const integrationRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/integrations/actions/:token', async (request) => {
    const params = request.params as { token: string };
    const body = parseOrThrow(actionSchema.safeParse(request.body ?? {}));
    const data = await app.integrationActionService.executeAction(params.token, body);
    return { data };
  });

  app.post('/api/v1/integrations', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(registerSchema.safeParse(request.body));
    const data = await app.integrationAdapterService.registerAdapter(request.auth!, body);
    return reply.status(201).send({ data });
  });

  app.patch('/api/v1/integrations/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(updateSchema.safeParse(request.body));
    const data = await app.integrationAdapterService.updateAdapter(request.auth!.tenantId, params.id, body);
    return { data };
  });

  app.get('/api/v1/integrations', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const data = await app.integrationAdapterService.listAdapters(request.auth!.tenantId);
    return { data };
  });

  app.delete('/api/v1/integrations/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const params = request.params as { id: string };
    await app.integrationAdapterService.deleteAdapter(request.auth!.tenantId, params.id);
    return reply.status(204).send();
  });
};
