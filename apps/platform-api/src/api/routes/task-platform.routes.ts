import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { applyArtifactPreviewHeaders } from '../../bootstrap/plugins.js';
import { buildArtifactStorageConfig } from '../../content/storage-config.js';
import { createArtifactStorage } from '../../content/storage-factory.js';
import { SchemaValidationFailedError, ValidationError } from '../../errors/domain-errors.js';
import { ArtifactCatalogService } from '../../services/artifact-catalog-service.js';
import { TaskAgentScopeService } from '../../services/task-agent-scope-service.js';

const memoryUpdatesSchema = z
  .record(z.string().min(1).max(256), z.unknown())
  .refine((value) => Object.keys(value).length > 0, {
    message: 'updates must contain at least one entry',
  });

const memoryPatchSchema = z.union([
  z.object({
    key: z.string().min(1).max(256),
    value: z.unknown(),
  }),
  z.object({
    updates: memoryUpdatesSchema,
  }),
]);

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const taskPlatformRoutes: FastifyPluginAsync = async (app) => {
  const taskScopeService = new TaskAgentScopeService(app.pgPool);
  const artifactCatalogService = new ArtifactCatalogService(
    app.pgPool,
    createArtifactStorage(buildArtifactStorageConfig(app.config)),
    app.config.ARTIFACT_ACCESS_URL_TTL_SECONDS,
    app.config.ARTIFACT_PREVIEW_MAX_BYTES,
  );

  app.get(
    '/api/v1/tasks/:id/memory',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as { key?: string };
      const task = await taskScopeService.loadAgentOwnedActiveTask(request.auth!, params.id);
      if (!task.project_id) {
        throw new ValidationError('Task is not linked to a project');
      }
      const project = await app.projectService.getProject(request.auth!.tenantId, task.project_id);
      const memory = project.memory ?? {};
      if (query.key) {
        return { data: { key: query.key, value: (memory as Record<string, unknown>)[query.key] } };
      }
      return { data: { memory } };
    },
  );

  app.patch(
    '/api/v1/tasks/:id/memory',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(memoryPatchSchema.safeParse(request.body));
      const task = await taskScopeService.loadAgentOwnedActiveTask(request.auth!, params.id);
      if (!task.project_id) {
        throw new ValidationError('Task is not linked to a project');
      }
      const context = {
        workflow_id: task.workflow_id,
        work_item_id: task.work_item_id,
        task_id: task.id,
        stage_name: task.stage_name,
      };

      if ('updates' in body) {
        return {
          data: await app.projectService.patchProjectMemoryEntries(
            request.auth!,
            task.project_id,
            Object.entries(body.updates).map(([key, value]) => ({
              key,
              value,
              context,
            })),
          ),
        };
      }

      return {
        data: await app.projectService.patchProjectMemory(request.auth!, task.project_id, {
          ...body,
          context,
        }),
      };
    },
  );

  app.get(
    '/api/v1/tasks/:id/artifact-catalog',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as {
        task_id?: string;
        work_item_id?: string;
        name_prefix?: string;
        limit?: string;
      };
      await taskScopeService.loadAgentOwnedActiveTask(request.auth!, params.id);
      const limit = query.limit === undefined ? undefined : Number(query.limit);
      if (query.limit !== undefined && !Number.isFinite(limit)) {
        throw new ValidationError('limit must be a valid number');
      }
      return {
        data: await artifactCatalogService.listArtifactsForTaskScope(
          request.auth!.tenantId,
          params.id,
          {
            task_id: query.task_id,
            work_item_id: query.work_item_id,
            name_prefix: query.name_prefix,
            limit,
          },
        ),
      };
    },
  );

  app.get(
    '/api/v1/tasks/:id/artifact-catalog/:artifactId',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { id: string; artifactId: string };
      await taskScopeService.loadAgentOwnedActiveTask(request.auth!, params.id);
      const result = await artifactCatalogService.downloadArtifactForTaskScope(
        request.auth!.tenantId,
        params.id,
        params.artifactId,
      );
      reply.header('Content-Type', result.contentType);
      reply.header('Content-Disposition', `attachment; filename="${params.artifactId}"`);
      return reply.send(result.data);
    },
  );

  async function sendCatalogPreviewResponse(
    request: FastifyRequest,
    reply: FastifyReply,
    params: { id: string; artifactId: string },
  ): Promise<FastifyReply> {
    await taskScopeService.loadAgentOwnedActiveTask(request.auth!, params.id);
    const result = await artifactCatalogService.previewArtifactForTaskScope(
      request.auth!.tenantId,
      params.id,
      params.artifactId,
    );
    applyArtifactPreviewHeaders(reply, result.fileName, result.contentType);
    return reply.send(result.data);
  }

  app.get(
    '/api/v1/tasks/:id/artifact-catalog/:artifactId/preview',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { id: string; artifactId: string };
      return sendCatalogPreviewResponse(request, reply, params);
    },
  );

  app.get(
    '/api/v1/tasks/:id/artifact-catalog/:artifactId/permalink',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { id: string; artifactId: string };
      return sendCatalogPreviewResponse(request, reply, params);
    },
  );
};
