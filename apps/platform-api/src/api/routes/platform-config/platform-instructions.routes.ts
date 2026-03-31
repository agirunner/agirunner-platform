import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError, ValidationError } from '../../../errors/domain-errors.js';
import { PlatformInstructionService } from '../../../services/platform-instruction-service.js';

const instructionSchema = z.object({
  content: z.string(),
  format: z.enum(['text', 'markdown']).optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const platformInstructionRoutes: FastifyPluginAsync = async (app) => {
  const service = new PlatformInstructionService(app.pgPool, app.eventService);

  app.get(
    '/api/v1/platform/instructions',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({ data: await service.getCurrent(request.auth!.tenantId) }),
  );

  app.put(
    '/api/v1/platform/instructions',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const payload = parseOrThrow(instructionSchema.safeParse(request.body ?? {}));
      return { data: await service.put(request.auth!, payload) };
    },
  );

  app.delete(
    '/api/v1/platform/instructions',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({ data: await service.clear(request.auth!) }),
  );

  app.get(
    '/api/v1/platform/instructions/versions',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => service.listVersions(request.auth!.tenantId),
  );

  app.get(
    '/api/v1/platform/instructions/versions/:version',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { version: string };
      const version = Number(params.version);
      if (!Number.isInteger(version) || version < 1) {
        throw new ValidationError('version must be a positive integer');
      }
      return { data: await service.getVersion(request.auth!.tenantId, version) };
    },
  );
};
