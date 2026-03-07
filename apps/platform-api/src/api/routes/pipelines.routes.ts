import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../pagination.js';
import { SchemaValidationFailedError, ValidationError } from '../../errors/domain-errors.js';
import { EventService } from '../../services/event-service.js';
import { listPipelineDocuments } from '../../services/document-reference-service.js';
import { PipelineService } from '../../services/pipeline-service.js';

const pipelineCreateSchema = z.object({
  template_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  parameters: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  config_overrides: z.record(z.unknown()).optional(),
  instruction_config: z.record(z.unknown()).optional(),
});

const manualReworkSchema = z.object({
  feedback: z.string().min(1).max(4000),
});

const phaseGateSchema = z.object({
  action: z.enum(['approve', 'reject', 'request_changes']),
  feedback: z.string().min(1).max(4000).optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const pipelineRoutes: FastifyPluginAsync = async (app) => {
  const pipelineService = new PipelineService(
    app.pgPool,
    new EventService(app.pgPool),
    app.config,
    app.workerConnectionHub,
  );

  app.post('/api/v1/pipelines', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(pipelineCreateSchema.safeParse(request.body));
    const pipeline = await pipelineService.createPipeline(request.auth!, body);
    return reply.status(201).send({ data: pipeline });
  });

  app.get('/api/v1/pipelines', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const page = Number(query.page ?? DEFAULT_PAGE);
    const perPage = Number(query.per_page ?? DEFAULT_PER_PAGE);
    if (!Number.isFinite(page) || page <= 0 || !Number.isFinite(perPage) || perPage <= 0 || perPage > MAX_PER_PAGE) {
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

  app.get('/api/v1/pipelines/:id/documents', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const documents = await listPipelineDocuments(app.pgPool, request.auth!.tenantId, params.id);
    return { data: documents };
  });

  app.get('/api/v1/pipelines/:id/config/resolved', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { show_layers?: string };
    const showLayers = query.show_layers === 'true';
    const config = await pipelineService.getResolvedConfig(request.auth!.tenantId, params.id, showLayers);
    return { data: config };
  });

  app.post('/api/v1/pipelines/:id/cancel', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const pipeline = await pipelineService.cancelPipeline(request.auth!, params.id);
    return { data: pipeline };
  });

  app.post('/api/v1/pipelines/:id/pause', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const pipeline = await pipelineService.pausePipeline(request.auth!, params.id);
    return { data: pipeline };
  });

  app.post('/api/v1/pipelines/:id/resume', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const pipeline = await pipelineService.resumePipeline(request.auth!, params.id);
    return { data: pipeline };
  });

  app.post('/api/v1/pipelines/:id/manual-rework', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(manualReworkSchema.safeParse(request.body));
    const pipeline = await pipelineService.manualReworkPipeline(request.auth!, params.id, body.feedback);
    return { data: pipeline };
  });

  app.post('/api/v1/pipelines/:id/phases/:name/gate', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string; name: string };
    const body = parseOrThrow(phaseGateSchema.safeParse(request.body));
    const pipeline = await pipelineService.actOnPhaseGate(request.auth!, params.id, params.name, body);
    return { data: pipeline };
  });

  app.post('/api/v1/pipelines/:id/phases/:name/cancel', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string; name: string };
    const pipeline = await pipelineService.cancelPhase(request.auth!, params.id, params.name);
    return { data: pipeline };
  });

  app.delete('/api/v1/pipelines/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const result = await pipelineService.deletePipeline(request.auth!, params.id);
    return { data: result };
  });
};
