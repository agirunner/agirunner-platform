import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withAllowedScopes, withScope } from '../../auth/fastify-auth-hook.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../pagination.js';
import { SchemaValidationFailedError, ValidationError } from '../../errors/domain-errors.js';
import { EventService } from '../../services/event-service.js';
import { PipelineService } from '../../services/pipeline-service.js';
import { ProjectPlanningService } from '../../services/project-planning-service.js';
import { ProjectService } from '../../services/project-service.js';
import { ProjectSpecService } from '../../services/project-spec-service.js';

const projectCreateSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  repository_url: z.string().url().optional(),
  settings: z.record(z.unknown()).optional(),
  memory: z.record(z.unknown()).optional(),
});

const projectUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    slug: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    repository_url: z.string().url().optional(),
    settings: z.record(z.unknown()).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const projectMemoryPatchSchema = z.object({
  key: z.string().min(1).max(256),
  value: z.unknown(),
});

const planningPipelineSchema = z.object({
  brief: z.string().min(1).max(20000),
  name: z.string().min(1).max(255).optional(),
});

const projectSpecSchema = z.object({
  resources: z.record(z.unknown()).optional(),
  documents: z.record(z.unknown()).optional(),
  tools: z.record(z.unknown()).optional(),
  config: z.record(z.unknown()).optional(),
  instructions: z.record(z.unknown()).optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }

  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const projectRoutes: FastifyPluginAsync = async (app) => {
  const projectService = new ProjectService(app.pgPool, new EventService(app.pgPool));
  const projectSpecService = new ProjectSpecService(app.pgPool, new EventService(app.pgPool));
  const pipelineService = new PipelineService(
    app.pgPool,
    new EventService(app.pgPool),
    app.config,
    app.workerConnectionHub,
  );
  const projectPlanningService = new ProjectPlanningService(app.pgPool, pipelineService);

  app.post('/api/v1/projects', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(projectCreateSchema.safeParse(request.body));
    const project = await projectService.createProject(request.auth!, body);
    return reply.status(201).send({ data: project });
  });

  app.get('/api/v1/projects', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const page = Number(query.page ?? DEFAULT_PAGE);
    const perPage = Number(query.per_page ?? DEFAULT_PER_PAGE);

    if (
      !Number.isFinite(page) ||
      page <= 0 ||
      !Number.isFinite(perPage) ||
      perPage <= 0 ||
      perPage > MAX_PER_PAGE
    ) {
      throw new ValidationError('Invalid pagination values');
    }

    return projectService.listProjects(request.auth!.tenantId, {
      page,
      per_page: perPage,
      q: query.q,
      is_active: query.is_active ? query.is_active === 'true' : undefined,
    });
  });

  app.get('/api/v1/projects/:id', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const project = await projectService.getProject(request.auth!.tenantId, params.id);
    return { data: project };
  });

  app.get('/api/v1/projects/:id/spec', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { version?: string };
    const version =
      query.version === undefined ? undefined : Number.isFinite(Number(query.version)) ? Number(query.version) : NaN;
    if (Number.isNaN(version)) {
      throw new ValidationError('version must be a valid integer');
    }
    const spec = await projectSpecService.getProjectSpec(request.auth!.tenantId, params.id, version);
    return { data: spec };
  });

  app.put('/api/v1/projects/:id/spec', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(projectSpecSchema.safeParse(request.body ?? {}));
    const spec = await projectSpecService.putProjectSpec(request.auth!, params.id, body);
    return { data: spec };
  });

  app.get('/api/v1/projects/:id/resources', { preHandler: [authenticateApiKey, withAllowedScopes(['agent', 'admin'])] }, async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { type?: string; task_id?: string };
    const resources = await projectSpecService.listProjectResources(request.auth!, params.id, query);
    return resources;
  });

  app.get('/api/v1/projects/:id/tools', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const tools = await projectSpecService.listProjectTools(request.auth!.tenantId, params.id);
    return tools;
  });

  app.patch('/api/v1/projects/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(projectUpdateSchema.safeParse(request.body));
    const project = await projectService.updateProject(request.auth!, params.id, body);
    return { data: project };
  });

  app.patch(
    '/api/v1/projects/:id/memory',
    { preHandler: [authenticateApiKey, withAllowedScopes(['agent', 'admin'])] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(
        projectMemoryPatchSchema.safeParse(request.body),
      ) as z.infer<typeof projectMemoryPatchSchema>;
      const project = await projectService.patchProjectMemory(request.auth!, params.id, body);
      return { data: project };
    },
  );

  app.post(
    '/api/v1/projects/:id/planning-pipeline',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(planningPipelineSchema.safeParse(request.body));
      const pipeline = await projectPlanningService.createPlanningPipeline(
        request.auth!,
        params.id,
        body,
      );
      return reply.status(201).send({ data: pipeline });
    },
  );

  app.delete('/api/v1/projects/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const result = await projectService.deleteProject(request.auth!, params.id);
    return { data: result };
  });
};
