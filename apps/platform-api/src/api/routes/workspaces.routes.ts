import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withAllowedScopes, withScope } from '../../auth/fastify-auth-hook.js';
import { applyArtifactPreviewHeaders } from '../../bootstrap/plugins.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../../lib/pagination.js';
import { SchemaValidationFailedError, ValidationError } from '../../errors/domain-errors.js';
import { WorkspacePlanningService } from '../../services/workspace-planning-service.js';
import { WorkspaceArtifactExplorerService } from '../../services/workspace-artifact-explorer-service.js';
import { deriveWorkspaceArtifactKey } from '../../services/workspace-artifact-file-service.js';
import { parseWorkspaceSettingsInput } from '../../services/workspace-settings.js';
import { WorkspaceSpecService } from '../../services/workspace-spec-service.js';

const workspaceCreateSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  repository_url: z.string().url().optional(),
  settings: z.record(z.unknown()).optional(),
  memory: z.record(z.unknown()).optional(),
}).superRefine((value, ctx) => validateWorkspaceModelOverrides(value.settings, ctx));

const workspaceUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    slug: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    repository_url: z.string().url().optional(),
    settings: z.record(z.unknown()).optional(),
    is_active: z.boolean().optional(),
  })
  .superRefine((value, ctx) => validateWorkspaceModelOverrides(value.settings, ctx))
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const gitWebhookConfigSchema = z.object({
  provider: z.enum(['github', 'gitea', 'gitlab']),
  secret: z.string().min(8),
});

const workspaceMemoryPatchSchema = z.object({
  key: z.string().min(1).max(256),
  value: z.unknown(),
});

const workspaceGitAccessVerifySchema = z.object({
  repository_url: z.string().url(),
  default_branch: z.string().min(1).max(255).optional(),
  git_token_mode: z.enum(['preserve', 'replace', 'clear']),
  git_token: z.string().max(20_000).optional(),
}).superRefine((value, ctx) => {
  if (value.git_token_mode === 'replace' && (!value.git_token || value.git_token.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['git_token'],
      message: 'git_token is required when git_token_mode=replace',
    });
  }
});

const planningWorkflowSchema = z.object({
  brief: z.string().min(1).max(20000),
  name: z.string().min(1).max(255).optional(),
});

const workspaceSpecSchema = z.object({
  resources: z.record(z.unknown()).optional(),
  documents: z.record(z.unknown()).optional(),
  tools: z.record(z.unknown()).optional(),
  config: z.record(z.unknown()).optional(),
  instructions: z.record(z.unknown()).optional(),
});

const workspaceArtifactListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  workflow_id: z.string().min(1).max(255).optional(),
  work_item_id: z.string().min(1).max(255).optional(),
  task_id: z.string().min(1).max(255).optional(),
  stage_name: z.string().min(1).max(255).optional(),
  role: z.string().min(1).max(255).optional(),
  content_type: z.string().min(1).max(255).optional(),
  preview_mode: z.enum(['inline', 'download']).optional(),
  created_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  created_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.enum(['newest', 'oldest', 'largest', 'smallest', 'name']).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(DEFAULT_PAGE),
  per_page: z.coerce.number().int().min(1).max(MAX_PER_PAGE).default(DEFAULT_PER_PAGE),
});

const workspaceArtifactFileUploadSchema = z.object({
  key: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  file_name: z.string().min(1).max(255),
  content_base64: z.string().min(1),
  content_type: z.string().min(1).max(255).optional(),
});

const workspaceArtifactFileBatchUploadSchema = z.object({
  files: z.array(workspaceArtifactFileUploadSchema).min(1),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }

  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  const workspaceService = app.workspaceService;
  const workspaceArtifactFileService = app.workspaceArtifactFileService;
  const workspaceSpecService = new WorkspaceSpecService(app.pgPool, app.eventService);
  const workspaceArtifactExplorerService = new WorkspaceArtifactExplorerService(
    app.pgPool,
    app.config.ARTIFACT_PREVIEW_MAX_BYTES,
  );
  const workflowService = app.workflowService;
  const workspacePlanningService = new WorkspacePlanningService(app.pgPool, workflowService);

  app.post('/api/v1/workspaces', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(workspaceCreateSchema.safeParse(request.body));
    const workspace = await workspaceService.createWorkspace(request.auth!, body);
    return reply.status(201).send({ data: workspace });
  });

  app.get('/api/v1/workspaces', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
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

    return workspaceService.listWorkspaces(request.auth!.tenantId, {
      page,
      per_page: perPage,
      q: query.q,
      is_active: query.is_active ? query.is_active === 'true' : undefined,
    });
  });

  app.get('/api/v1/workspaces/:id', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const workspace = await workspaceService.getWorkspace(request.auth!.tenantId, params.id);
    return { data: workspace };
  });

  app.get(
    '/api/v1/workspaces/:id/delete-impact',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await workspaceService.getWorkspaceDeleteImpact(request.auth!, params.id),
      };
    },
  );

  app.post(
    '/api/v1/workspaces/:id/verify-git-access',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workspaceGitAccessVerifySchema.safeParse(request.body));
      return {
        data: await workspaceService.verifyWorkspaceGitAccess(request.auth!, params.id, body),
      };
    },
  );

  app.get('/api/v1/workspaces/:id/timeline', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const timeline = await workflowService.getWorkspaceTimeline(request.auth!.tenantId, params.id);
    return { data: timeline };
  });

  app.get(
    '/api/v1/workspaces/:id/files',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const files = await workspaceArtifactFileService.listWorkspaceArtifactFiles(
        request.auth!.tenantId,
        params.id,
      );
      return { data: files };
    },
  );

  app.post(
    '/api/v1/workspaces/:id/files',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workspaceArtifactFileUploadSchema.safeParse(request.body));
      const file = await workspaceArtifactFileService.uploadWorkspaceArtifactFile(
        request.auth!,
        params.id,
        {
          key: body.key,
          description: body.description,
          fileName: body.file_name,
          contentBase64: body.content_base64,
          contentType: body.content_type,
        },
      );
      return reply.status(201).send({ data: file });
    },
  );

  app.post(
    '/api/v1/workspaces/:id/files/batch',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workspaceArtifactFileBatchUploadSchema.safeParse(request.body));
      const files = await workspaceArtifactFileService.uploadWorkspaceArtifactFiles(
        request.auth!,
        params.id,
        body.files.map((entry) => ({
          key: entry.key ?? deriveWorkspaceArtifactKey(entry.file_name),
          description: entry.description,
          fileName: entry.file_name,
          contentBase64: entry.content_base64,
          contentType: entry.content_type,
        })),
      );
      return reply.status(201).send({ data: files });
    },
  );

  app.get(
    '/api/v1/workspaces/:id/files/:fileId/content',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { id: string; fileId: string };
      const result = await workspaceArtifactFileService.downloadWorkspaceArtifactFile(
        request.auth!.tenantId,
        params.id,
        params.fileId,
      );
      applyArtifactPreviewHeaders(reply, result.file.file_name, result.contentType);
      return reply.send(result.data);
    },
  );

  app.delete(
    '/api/v1/workspaces/:id/files/:fileId',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string; fileId: string };
      await workspaceArtifactFileService.deleteWorkspaceArtifactFile(
        request.auth!,
        params.id,
        params.fileId,
      );
      return reply.status(204).send();
    },
  );

  app.get(
    '/api/v1/workspaces/:id/artifacts',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = parseOrThrow(workspaceArtifactListQuerySchema.safeParse(request.query ?? {}));
      await workspaceService.getWorkspace(request.auth!.tenantId, params.id);
      return workspaceArtifactExplorerService.listWorkspaceArtifacts(
        request.auth!.tenantId,
        params.id,
        query,
      );
    },
  );

  app.get('/api/v1/workspaces/:id/spec', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { version?: string };
    const version =
      query.version === undefined ? undefined : Number.isFinite(Number(query.version)) ? Number(query.version) : NaN;
    if (Number.isNaN(version)) {
      throw new ValidationError('version must be a valid integer');
    }
    const spec = await workspaceSpecService.getWorkspaceSpec(request.auth!.tenantId, params.id, version);
    return { data: spec };
  });

  app.put('/api/v1/workspaces/:id/spec', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(workspaceSpecSchema.safeParse(request.body ?? {}));
    const spec = await workspaceSpecService.putWorkspaceSpec(request.auth!, params.id, body);
    return { data: spec };
  });

  app.get('/api/v1/workspaces/:id/resources', { preHandler: [authenticateApiKey, withAllowedScopes(['agent', 'admin'])] }, async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { type?: string; task_id?: string };
    const resources = await workspaceSpecService.listWorkspaceResources(request.auth!, params.id, query);
    return resources;
  });

  app.get('/api/v1/workspaces/:id/tools', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const tools = await workspaceSpecService.listWorkspaceTools(request.auth!.tenantId, params.id);
    return tools;
  });

  app.patch('/api/v1/workspaces/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(workspaceUpdateSchema.safeParse(request.body));
    const workspace = await workspaceService.updateWorkspace(request.auth!, params.id, body);
    return { data: workspace };
  });

  app.patch(
    '/api/v1/workspaces/:id/memory',
    { preHandler: [authenticateApiKey, withAllowedScopes(['agent', 'admin'])] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(
        workspaceMemoryPatchSchema.safeParse(request.body),
      ) as z.infer<typeof workspaceMemoryPatchSchema>;
      const workspace = await workspaceService.patchWorkspaceMemory(request.auth!, params.id, body);
      return { data: workspace };
    },
  );

  app.delete(
    '/api/v1/workspaces/:id/memory/:key',
    { preHandler: [authenticateApiKey, withAllowedScopes(['agent', 'admin'])] },
    async (request) => {
      const params = request.params as { id: string; key: string };
      const workspace = await workspaceService.removeWorkspaceMemory(
        request.auth!,
        params.id,
        params.key,
      );
      return { data: workspace };
    },
  );

  app.post(
    '/api/v1/workspaces/:id/planning-workflow',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(planningWorkflowSchema.safeParse(request.body));
      const workflow = await workspacePlanningService.createPlanningWorkflow(
        request.auth!,
        params.id,
        body,
      );
      return reply.status(201).send({ data: workflow });
    },
  );

  app.put(
    '/api/v1/workspaces/:id/git-webhook',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(gitWebhookConfigSchema.safeParse(request.body));
      const result = await workspaceService.setGitWebhookConfig(request.auth!, params.id, body);
      return { data: result };
    },
  );

  app.delete('/api/v1/workspaces/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { cascade?: string };
    const result = await workspaceService.deleteWorkspace(request.auth!, params.id, {
      cascade: query.cascade === 'true',
    });
    return { data: result };
  });
};

function validateWorkspaceModelOverrides(settings: unknown, ctx: z.RefinementCtx) {
  try {
    parseWorkspaceSettingsInput(settings);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'settings must be valid workspace settings',
      path: ['settings'],
    });
  }
}
