import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';

const playbookCreateSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(120).optional(),
  description: z.string().max(4000).optional(),
  outcome: z.string().min(1).max(4000),
  lifecycle: z.enum(['standard', 'continuous']).optional(),
  definition: z.record(z.unknown()),
});

const playbookUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    slug: z.string().min(1).max(120).optional(),
    description: z.string().max(4000).optional(),
    outcome: z.string().min(1).max(4000).optional(),
    lifecycle: z.enum(['standard', 'continuous']).optional(),
    definition: z.record(z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const playbookRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/playbooks', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(playbookCreateSchema.safeParse(request.body));
    const playbook = await app.playbookService.createPlaybook(request.auth!.tenantId, body);
    return reply.status(201).send({ data: playbook });
  });

  app.get('/api/v1/playbooks', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    return { data: await app.playbookService.listPlaybooks(request.auth!.tenantId) };
  });

  app.get('/api/v1/playbooks/:id', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    return { data: await app.playbookService.getPlaybook(request.auth!.tenantId, params.id) };
  });

  app.patch('/api/v1/playbooks/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(playbookUpdateSchema.safeParse(request.body));
    return { data: await app.playbookService.updatePlaybook(request.auth!.tenantId, params.id, body) };
  });

  app.put('/api/v1/playbooks/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(playbookCreateSchema.safeParse(request.body));
    return { data: await app.playbookService.replacePlaybook(request.auth!.tenantId, params.id, body) };
  });
};
