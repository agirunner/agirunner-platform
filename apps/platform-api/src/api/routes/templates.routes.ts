import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../pagination.js';
import { SchemaValidationFailedError, ValidationError } from '../../errors/domain-errors.js';
import { EventService } from '../../services/event-service.js';
import { TemplateService } from '../../services/template-service.js';

const templateCreateSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  is_published: z.boolean().optional(),
  schema: z.record(z.unknown()),
});

const templatePatchSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    slug: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    is_published: z.boolean().optional(),
    schema: z.record(z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const templateRoutes: FastifyPluginAsync = async (app) => {
  const templateService = new TemplateService(app.pgPool, new EventService(app.pgPool));

  app.post('/api/v1/templates', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(templateCreateSchema.safeParse(request.body));
    const template = await templateService.createTemplate(request.auth!, body);
    return reply.status(201).send({ data: template });
  });

  app.get('/api/v1/templates', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const page = Number(query.page ?? DEFAULT_PAGE);
    const perPage = Number(query.per_page ?? DEFAULT_PER_PAGE);
    if (!Number.isFinite(page) || page <= 0 || !Number.isFinite(perPage) || perPage <= 0 || perPage > MAX_PER_PAGE) {
      throw new ValidationError('Invalid pagination values');
    }

    const result = await templateService.listTemplates(request.auth!.tenantId, {
      q: query.q,
      slug: query.slug,
      is_built_in: query.is_built_in ? query.is_built_in === 'true' : undefined,
      page,
      per_page: perPage,
    });

    return result;
  });

  app.get('/api/v1/templates/:id', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const template = await templateService.getTemplate(request.auth!.tenantId, params.id);
    return { data: template };
  });

  app.patch('/api/v1/templates/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(templatePatchSchema.safeParse(request.body));
    const template = await templateService.updateTemplate(request.auth!, params.id, body);
    return { data: template };
  });

  app.delete('/api/v1/templates/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const template = await templateService.softDeleteTemplate(request.auth!, params.id);
    return { data: template };
  });
};
