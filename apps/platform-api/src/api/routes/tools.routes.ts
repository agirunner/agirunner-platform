import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';
import { ToolTagService } from '../../services/tool-tag-service.js';

const createToolTagSchema = z.object({
  id: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  category: z.enum(['runtime', 'vcs', 'web', 'language', 'integration']).optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const toolRoutes: FastifyPluginAsync = async (app) => {
  const toolTagService = new ToolTagService(app.pgPool);

  app.get('/api/v1/tools', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    return toolTagService.listToolTags(request.auth!.tenantId);
  });

  app.post('/api/v1/tools', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(createToolTagSchema.safeParse(request.body));
    const tool = await toolTagService.createToolTag(request.auth!, body);
    return reply.status(201).send({ data: tool });
  });
};
