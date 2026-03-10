import { Readable } from 'node:stream';

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';
import { WebhookTaskTriggerService } from '../../services/webhook-task-trigger-service.js';

const triggerSchema = z.object({
  name: z.string().min(1).max(255),
  source: z.string().min(1).max(255),
  project_id: z.string().uuid().optional(),
  workflow_id: z.string().uuid().optional(),
  event_header: z.string().min(1).max(255).optional(),
  event_types: z.array(z.string().min(1)).optional(),
  signature_header: z.string().min(1).max(255),
  signature_mode: z.enum(['hmac_sha256', 'shared_secret']),
  secret: z.string().min(8),
  field_mappings: z.record(z.unknown()).optional(),
  defaults: z.record(z.unknown()).optional(),
  is_active: z.boolean().optional(),
});

const triggerPatchSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    source: z.string().min(1).max(255).optional(),
    project_id: z.string().uuid().nullable().optional(),
    workflow_id: z.string().uuid().nullable().optional(),
    event_header: z.string().min(1).max(255).nullable().optional(),
    event_types: z.array(z.string().min(1)).optional(),
    signature_header: z.string().min(1).max(255).optional(),
    signature_mode: z.enum(['hmac_sha256', 'shared_secret']).optional(),
    secret: z.string().min(8).optional(),
    field_mappings: z.record(z.unknown()).optional(),
    defaults: z.record(z.unknown()).optional(),
    is_active: z.boolean().optional(),
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

async function captureRawBody(payload: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of payload) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export const webhookTaskTriggerRoutes: FastifyPluginAsync = async (app) => {
  const taskService = app.taskService;
  const triggerService = new WebhookTaskTriggerService(
    app.pgPool,
    app.eventService,
    taskService,
    app.config.WEBHOOK_ENCRYPTION_KEY,
  );

  app.post('/api/v1/task-triggers', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(triggerSchema.safeParse(request.body));
    const trigger = await triggerService.createTrigger(request.auth!, body);
    return reply.status(201).send({ data: trigger });
  });

  app.get('/api/v1/task-triggers', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    return triggerService.listTriggers(request.auth!.tenantId);
  });

  app.patch('/api/v1/task-triggers/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(triggerPatchSchema.safeParse(request.body));
    const trigger = await triggerService.updateTrigger(request.auth!.tenantId, params.id, body);
    return { data: trigger };
  });

  app.delete('/api/v1/task-triggers/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const result = await triggerService.deleteTrigger(request.auth!.tenantId, params.id);
    return { data: result };
  });

  app.post(
    '/api/v1/task-triggers/:id/invoke',
    {
      preParsing: async (request, _reply, payload) => {
        const rawBody = await captureRawBody(payload);
        request.rawBody = rawBody;
        return Readable.from(rawBody);
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const rawBody = request.rawBody ?? Buffer.from('{}');
      const result = await triggerService.invokeTrigger(
        params.id,
        request.headers,
        rawBody,
        asRecord(request.body),
      );
      return reply.status(202).send({ data: result });
    },
  );
};
