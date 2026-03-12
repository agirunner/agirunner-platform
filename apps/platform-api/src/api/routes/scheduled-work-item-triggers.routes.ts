import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';

const triggerSchema = z.object({
  name: z.string().min(1).max(255),
  source: z.string().min(1).max(255),
  project_id: z.string().uuid().optional(),
  workflow_id: z.string().uuid(),
  cadence_minutes: z.coerce.number().int().min(1),
  defaults: z.record(z.unknown()).optional(),
  is_active: z.boolean().optional(),
  next_fire_at: z.string().datetime().optional(),
});

const triggerPatchSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    source: z.string().min(1).max(255).optional(),
    project_id: z.string().uuid().nullable().optional(),
    workflow_id: z.string().uuid().optional(),
    cadence_minutes: z.coerce.number().int().min(1).optional(),
    defaults: z.record(z.unknown()).optional(),
    is_active: z.boolean().optional(),
    next_fire_at: z.string().datetime().optional(),
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

export const scheduledWorkItemTriggerRoutes: FastifyPluginAsync = async (app) => {
  const triggerService = app.scheduledWorkItemTriggerService;

  app.post('/api/v1/scheduled-work-item-triggers', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(triggerSchema.safeParse(request.body));
    const trigger = await triggerService.createTrigger(request.auth!, body);
    return reply.status(201).send({ data: trigger });
  });

  app.get('/api/v1/scheduled-work-item-triggers', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    return triggerService.listTriggers(request.auth!.tenantId);
  });

  app.patch('/api/v1/scheduled-work-item-triggers/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(triggerPatchSchema.safeParse(request.body));
    const trigger = await triggerService.updateTrigger(request.auth!.tenantId, params.id, body);
    return { data: trigger };
  });

  app.delete('/api/v1/scheduled-work-item-triggers/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const result = await triggerService.deleteTrigger(request.auth!.tenantId, params.id);
    return { data: result };
  });
};
