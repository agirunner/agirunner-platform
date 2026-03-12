import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withAllowedScopes, withScope } from '../../auth/fastify-auth-hook.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../pagination.js';
import { SchemaValidationFailedError, ValidationError } from '../../errors/domain-errors.js';
import { ProjectPlanningService } from '../../services/project-planning-service.js';
import { ProjectSpecService } from '../../services/project-spec-service.js';

const projectCreateSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  repository_url: z.string().url().optional(),
  settings: z.record(z.unknown()).optional(),
  memory: z.record(z.unknown()).optional(),
}).superRefine((value, ctx) => validateProjectModelOverrides(value.settings, ctx));

const projectUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    slug: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    repository_url: z.string().url().optional(),
    settings: z.record(z.unknown()).optional(),
    is_active: z.boolean().optional(),
  })
  .superRefine((value, ctx) => validateProjectModelOverrides(value.settings, ctx))
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const roleModelOverrideSchema = z.object({
  provider: z.string().min(1).max(120),
  model: z.string().min(1).max(200),
  reasoning_config: z.record(z.unknown()).nullable().optional(),
});

const modelOverridesSchema = z.record(z.string().min(1).max(120), roleModelOverrideSchema);

const gitWebhookConfigSchema = z.object({
  provider: z.enum(['github', 'gitea', 'gitlab']),
  secret: z.string().min(8),
});

const projectMemoryPatchSchema = z.object({
  key: z.string().min(1).max(256),
  value: z.unknown(),
});

const planningWorkflowSchema = z.object({
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
  const projectService = app.projectService;
  const projectSpecService = new ProjectSpecService(app.pgPool, app.eventService);
  const workflowService = app.workflowService;
  const projectPlanningService = new ProjectPlanningService(app.pgPool, workflowService);

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

  app.get(
    '/api/v1/projects/:id/model-overrides',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const project = await projectService.getProject(request.auth!.tenantId, params.id);
      return {
        data: {
          project_id: params.id,
          model_overrides: readModelOverrides(asRecord(project.settings).model_overrides),
        },
      };
    },
  );

  app.get(
    '/api/v1/projects/:id/model-overrides/resolved',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as { roles?: string };
      const project = await projectService.getProject(request.auth!.tenantId, params.id);
      const projectOverrides = readModelOverrides(asRecord(project.settings).model_overrides);
      const roles = parseRoleQuery(query.roles, projectOverrides);
      return {
        data: {
          project_id: params.id,
          project_model_overrides: projectOverrides,
          effective_models: await resolveEffectiveModels(
            app.modelCatalogService,
            request.auth!.tenantId,
            roles,
            projectOverrides,
          ),
        },
      };
    },
  );

  app.get('/api/v1/projects/:id/timeline', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const timeline = await workflowService.getProjectTimeline(request.auth!.tenantId, params.id);
    return { data: timeline };
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
    '/api/v1/projects/:id/planning-workflow',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(planningWorkflowSchema.safeParse(request.body));
      const workflow = await projectPlanningService.createPlanningWorkflow(
        request.auth!,
        params.id,
        body,
      );
      return reply.status(201).send({ data: workflow });
    },
  );

  app.put(
    '/api/v1/projects/:id/git-webhook',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(gitWebhookConfigSchema.safeParse(request.body));
      const result = await projectService.setGitWebhookConfig(request.auth!, params.id, body);
      return { data: result };
    },
  );

  app.delete('/api/v1/projects/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const result = await projectService.deleteProject(request.auth!, params.id);
    return { data: result };
  });
};

function validateProjectModelOverrides(settings: unknown, ctx: z.RefinementCtx) {
  const parsed = modelOverridesSchema.safeParse(asRecord(settings).model_overrides ?? {});
  if (!parsed.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'settings.model_overrides must be a valid model override map',
      path: ['settings', 'model_overrides'],
    });
  }
}

function parseRoleQuery(raw: string | undefined, projectOverrides: Record<string, unknown>) {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.split(',').map((value) => value.trim()).filter(Boolean);
  }
  return Object.keys(projectOverrides);
}

function readModelOverrides(value: unknown): Record<string, unknown> {
  const parsed = modelOverridesSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

async function resolveEffectiveModels(
  modelCatalogService: {
    resolveRoleConfig(tenantId: string, roleName: string): Promise<unknown>;
    listProviders(tenantId: string): Promise<unknown[]>;
    listModels(tenantId: string, providerId?: string): Promise<unknown[]>;
    getProviderForOperations(tenantId: string, id: string): Promise<unknown>;
  },
  tenantId: string,
  roles: string[],
  projectOverrides: Record<string, unknown>,
) {
  const providers = (await modelCatalogService.listProviders(tenantId)) as Array<Record<string, unknown>>;
  const byId = new Map(providers.map((provider) => [String(provider.id), provider]));
  const byName = new Map(
    providers.flatMap((provider) => {
      const record = provider as Record<string, unknown>;
      const names = [record.name, asRecord(record.metadata).providerType].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
      return names.map((name) => [name, provider] as const);
    }),
  );

  const results: Record<string, unknown> = {};
  for (const role of roles) {
    const baseResolved = (await modelCatalogService.resolveRoleConfig(tenantId, role)) as
      | Record<string, unknown>
      | null;
    const projectOverride = asRecord(projectOverrides[role]);

    if (Object.keys(projectOverride).length === 0) {
      results[role] = { source: 'base', resolved: baseResolved, fallback: baseResolved === null };
      continue;
    }

    const providerRef = String(projectOverride.provider);
    const provider = byId.get(providerRef) ?? byName.get(providerRef);
    if (!provider) {
      results[role] = {
        source: 'project',
        resolved: baseResolved,
        fallback: true,
        fallback_reason: `provider '${providerRef}' is not available`,
      };
      continue;
    }

    const models = (await modelCatalogService.listModels(
      tenantId,
      String(provider.id),
    )) as Array<Record<string, unknown>>;
    const model = models.find(
      (entry) =>
        String((entry as Record<string, unknown>).model_id) === String(projectOverride.model)
        && (entry as Record<string, unknown>).is_enabled === true,
    );
    if (!model) {
      results[role] = {
        source: 'project',
        resolved: baseResolved,
        fallback: true,
        fallback_reason: `model '${String(projectOverride.model)}' is not enabled for provider '${providerRef}'`,
      };
      continue;
    }

    const providerDetails = (await modelCatalogService.getProviderForOperations(
      tenantId,
      String((provider as Record<string, unknown>).id),
    )) as Record<string, unknown>;
    results[role] = {
      source: 'project',
      resolved: {
        provider: {
          name: providerDetails.name,
          providerType: asRecord(providerDetails.metadata).providerType ?? providerDetails.name,
          baseUrl: providerDetails.base_url,
          authMode: providerDetails.auth_mode ?? 'api_key',
          providerId: providerDetails.auth_mode === 'oauth' ? providerDetails.id : null,
        },
        model: {
          modelId: model.model_id,
          contextWindow: model.context_window ?? null,
          endpointType: model.endpoint_type ?? null,
          reasoningConfig: model.reasoning_config ?? null,
        },
        reasoningConfig:
          projectOverride.reasoning_config === undefined
            ? (baseResolved as Record<string, unknown> | null)?.reasoningConfig ?? null
            : projectOverride.reasoning_config,
      },
      fallback: false,
    };
  }
  return results;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
