import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError, ValidationError } from '../../errors/domain-errors.js';
import { EventService } from '../../services/event-service.js';
import { PipelineService } from '../../services/pipeline-service.js';

const pipelineCreateSchema = z.object({
  template_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  parameters: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const pipelineRoutes: FastifyPluginAsync = async (app) => {
  const pipelineService = new PipelineService(app.pgPool, new EventService(app.pgPool));

  app.post('/api/v1/pipelines', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(pipelineCreateSchema.safeParse(request.body));
    const pipeline = await pipelineService.createPipeline(request.auth!, body);
    return reply.status(201).send({ data: pipeline });
  });

  app.get('/api/v1/pipelines', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const page = Number(query.page ?? 1);
    const perPage = Number(query.per_page ?? 20);
    if (!Number.isFinite(page) || page <= 0 || !Number.isFinite(perPage) || perPage <= 0 || perPage > 100) {
      throw new ValidationError('Invalid pagination values');
    }

    return pipelineService.listPipelines(request.auth!.tenantId, {
      project_id: query.project_id,
      state: query.state,
      template_id: query.template_id,
      page,
      per_page: perPage,
    });
  });

  app.get('/api/v1/pipelines/:id', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const pipeline = await pipelineService.getPipeline(request.auth!.tenantId, params.id);
    return { data: pipeline };
  });

  app.post('/api/v1/pipelines/:id/cancel', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const pipeline = await pipelineService.cancelPipeline(request.auth!, params.id);
    return { data: pipeline };
  });
};
