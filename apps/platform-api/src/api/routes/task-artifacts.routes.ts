import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withAllowedScopes } from '../../auth/fastify-auth-hook.js';
import { buildArtifactStorageConfig } from '../../content/storage-config.js';
import { createArtifactStorage } from '../../content/storage-factory.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';
import { ArtifactService } from '../../services/artifact-service.js';

const artifactUploadSchema = z.object({
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
  const artifactService = new ArtifactService(
    app.pgPool,
    createArtifactStorage(buildArtifactStorageConfig(app.config)),
    app.config.ARTIFACT_ACCESS_URL_TTL_SECONDS,
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
      const artifact = await artifactService.uploadTaskArtifact(request.auth!, params.id, {
        path: body.path,
        contentBase64: body.content_base64,
        contentType: body.content_type,
        metadata: body.metadata,
      });
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
