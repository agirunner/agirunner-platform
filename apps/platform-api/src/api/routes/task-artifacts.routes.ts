import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withAllowedScopes } from '../../auth/fastify-auth-hook.js';
import { applyArtifactPreviewHeaders } from '../../bootstrap/plugins.js';
import { buildArtifactStorageConfig } from '../../content/storage-config.js';
import { createArtifactStorage } from '../../content/storage-factory.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';
import { ArtifactService } from '../../services/artifact-service.js';
import { WorkflowToolResultService } from '../../services/workflow-tool-result-service.js';
import { runIdempotentTaskRouteAction } from './task-route-idempotency.js';

const artifactUploadSchema = z.object({
  request_id: z.string().min(1).max(255).optional(),
  path: z.string().min(1).max(1024),
  content_base64: z.string().min(1),
  content_type: z.string().min(1).max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const taskArtifactRoutes: FastifyPluginAsync = async (app) => {
  const taskService = app.taskService;
  const toolResultService = new WorkflowToolResultService(app.pgPool);
  const artifactService = new ArtifactService(
    app.pgPool,
    createArtifactStorage(buildArtifactStorageConfig(app.config)),
    app.config.ARTIFACT_ACCESS_URL_TTL_SECONDS,
    app.config.ARTIFACT_PREVIEW_MAX_BYTES,
  );

  app.get(
    '/api/v1/tasks/:id/artifacts',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'agent'])] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as { prefix?: string };
      const artifacts = await artifactService.listTaskArtifacts(
        request.auth!.tenantId,
        params.id,
        query.prefix,
      );
      return { data: artifacts };
    },
  );

  app.post(
    '/api/v1/tasks/:id/artifacts',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'agent'])] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(artifactUploadSchema.safeParse(request.body));
      const uploadArtifact = async () =>
        (await artifactService.uploadTaskArtifact(request.auth!, params.id, {
          path: body.path,
          contentBase64: body.content_base64,
          contentType: body.content_type,
          metadata: body.metadata,
        })) as unknown as Record<string, unknown>;
      const artifact = await runIdempotentTaskRouteAction(
        app,
        toolResultService,
        taskService.getTask.bind(taskService),
        request.auth!.tenantId,
        params.id,
        'task_artifact_upload',
        body.request_id,
        uploadArtifact,
      );
      return reply.status(201).send({ data: artifact });
    },
  );

  app.get(
    '/api/v1/tasks/:id/artifacts/:artifactId',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'agent'])] },
    async (request, reply) => {
      const params = request.params as { id: string; artifactId: string };
      const result = await artifactService.downloadTaskArtifact(
        request.auth!.tenantId,
        params.id,
        params.artifactId,
      );
      reply.header('Content-Type', result.contentType);
      reply.header('Content-Disposition', `attachment; filename="${params.artifactId}"`);
      return reply.send(result.data);
    },
  );

  async function sendPreviewResponse(
    request: FastifyRequest,
    reply: FastifyReply,
    params: { id: string; artifactId: string },
  ): Promise<FastifyReply> {
    const result = await artifactService.previewTaskArtifact(
      request.auth!.tenantId,
      params.id,
      params.artifactId,
    );
    applyArtifactPreviewHeaders(reply, result.fileName, result.contentType);
    return reply.send(result.data);
  }

  app.get(
    '/api/v1/tasks/:id/artifacts/:artifactId/preview',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'agent'])] },
    async (request, reply) => {
      const params = request.params as { id: string; artifactId: string };
      return sendPreviewResponse(request, reply, params);
    },
  );

  app.get(
    '/api/v1/tasks/:id/artifacts/:artifactId/permalink',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'agent'])] },
    async (request, reply) => {
      const params = request.params as { id: string; artifactId: string };
      return sendPreviewResponse(request, reply, params);
    },
  );

  app.delete(
    '/api/v1/tasks/:id/artifacts/:artifactId',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'agent'])] },
    async (request, reply) => {
      const params = request.params as { id: string; artifactId: string };
      await artifactService.deleteTaskArtifact(request.auth!, params.id, params.artifactId);
      return reply.status(204).send();
    },
  );
};
