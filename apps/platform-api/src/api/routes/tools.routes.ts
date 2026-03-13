import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';

const createToolTagSchema = z.object({
  id: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  category: z.enum(['runtime', 'vcs', 'web', 'language', 'integration']).optional(),
});

const updateToolTagSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(1000).optional(),
    category: z.enum(['runtime', 'vcs', 'web', 'language', 'integration']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const toolRoutes: FastifyPluginAsync = async (app) => {
  const toolTagService = app.toolTagService;

  app.get('/api/v1/tools', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    return toolTagService.listToolTags(request.auth!.tenantId);
  });

  app.post('/api/v1/tools', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(createToolTagSchema.safeParse(request.body));
    const tool = await toolTagService.createToolTag(request.auth!, body);
    return reply.status(201).send({ data: tool });
  });

  app.patch('/api/v1/tools/:toolId', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const { toolId } = request.params as { toolId: string };
    const body = parseOrThrow(updateToolTagSchema.safeParse(request.body));
    const tool = await toolTagService.updateToolTag(request.auth!, toolId, body);
    return { data: tool };
  });

  app.delete('/api/v1/tools/:toolId', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const { toolId } = request.params as { toolId: string };
    await toolTagService.deleteToolTag(request.auth!, toolId);
    return reply.status(204).send();
  });
};
