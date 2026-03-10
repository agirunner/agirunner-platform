import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../pagination.js';
import { SchemaValidationFailedError, ValidationError } from '../../errors/domain-errors.js';
import { listWorkflowDocuments } from '../../services/document-reference-service.js';
import { WorkflowChainingService } from '../../services/workflow-chaining-service.js';

const workflowCreateSchema = z.object({
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
  override_input: z.record(z.unknown()).optional(),
});

const workflowChainSchema = z.object({
  template_id: z.string().uuid().optional(),
  name: z.string().min(1).max(255).optional(),
  parameters: z.record(z.unknown()).optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const workflowRoutes: FastifyPluginAsync = async (app) => {
  const workflowService = app.workflowService;
  const workflowChainingService = new WorkflowChainingService(app.pgPool, workflowService);

  app.post('/api/v1/workflows', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(workflowCreateSchema.safeParse(request.body));
    const workflow = await workflowService.createWorkflow(request.auth!, body);
    return reply.status(201).send({ data: workflow });
  });

  app.get('/api/v1/workflows', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const page = Number(query.page ?? DEFAULT_PAGE);
    const perPage = Number(query.per_page ?? DEFAULT_PER_PAGE);
    if (!Number.isFinite(page) || page <= 0 || !Number.isFinite(perPage) || perPage <= 0 || perPage > MAX_PER_PAGE) {
      throw new ValidationError('Invalid pagination values');
    }

    return workflowService.listWorkflows(request.auth!.tenantId, {
      project_id: query.project_id,
      state: query.state,
      template_id: query.template_id,
      page,
      per_page: perPage,
    });
  });

  app.get('/api/v1/workflows/:id', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const workflow = await workflowService.getWorkflow(request.auth!.tenantId, params.id);
    return { data: workflow };
  });

  app.get('/api/v1/workflows/:id/documents', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const documents = await listWorkflowDocuments(app.pgPool, request.auth!.tenantId, params.id);
    return { data: documents };
  });

  app.get('/api/v1/workflows/:id/config/resolved', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { show_layers?: string };
    const showLayers = query.show_layers === 'true';
    const config = await workflowService.getResolvedConfig(request.auth!.tenantId, params.id, showLayers);
    return { data: config };
  });

  app.post('/api/v1/workflows/:id/cancel', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const workflow = await workflowService.cancelWorkflow(request.auth!, params.id);
    return { data: workflow };
  });

  app.post('/api/v1/workflows/:id/pause', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const workflow = await workflowService.pauseWorkflow(request.auth!, params.id);
    return { data: workflow };
  });

  app.post('/api/v1/workflows/:id/resume', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const workflow = await workflowService.resumeWorkflow(request.auth!, params.id);
    return { data: workflow };
  });

  app.post('/api/v1/workflows/:id/manual-rework', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(manualReworkSchema.safeParse(request.body));
    const workflow = await workflowService.manualReworkWorkflow(request.auth!, params.id, body.feedback);
    return { data: workflow };
  });

  app.post('/api/v1/workflows/:id/chain', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(workflowChainSchema.safeParse(request.body ?? {}));
    const workflow = body.template_id
      ? await workflowChainingService.chainWorkflowExplicit(request.auth!, params.id, body as { template_id: string; name?: string; parameters?: Record<string, unknown> })
      : await workflowChainingService.chainWorkflowFromSuggestedPlan(request.auth!, params.id, body);
    return reply.status(201).send({ data: workflow });
  });

  app.post('/api/v1/workflows/:id/phases/:name/gate', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string; name: string };
    const body = parseOrThrow(phaseGateSchema.safeParse(request.body));
    const workflow = await workflowService.actOnPhaseGate(request.auth!, params.id, params.name, body);
    return { data: workflow };
  });

  app.post('/api/v1/workflows/:id/phases/:name/cancel', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string; name: string };
    const workflow = await workflowService.cancelPhase(request.auth!, params.id, params.name);
    return { data: workflow };
  });

  app.delete('/api/v1/workflows/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const result = await workflowService.deleteWorkflow(request.auth!, params.id);
    return { data: result };
  });
};
