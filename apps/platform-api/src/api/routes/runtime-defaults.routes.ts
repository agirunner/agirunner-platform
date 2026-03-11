import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import type {
  CreateRuntimeDefaultInput,
  UpdateRuntimeDefaultInput,
} from '../../services/runtime-defaults-service.js';

export const runtimeDefaultsRoutes: FastifyPluginAsync = async (app) => {
  const service = app.runtimeDefaultsService;

  app.get(
    '/api/v1/config/runtime-defaults',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({ data: await service.listDefaults(request.auth!.tenantId) }),
  );

  app.get(
    '/api/v1/config/runtime-defaults/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await service.getDefault(request.auth!.tenantId, params.id) };
    },
  );

  app.post(
    '/api/v1/config/runtime-defaults',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const result = await service.upsertDefault(
        request.auth!.tenantId,
        request.body as CreateRuntimeDefaultInput,
      );
      reply.status(201);
      return { data: result };
    },
  );

  app.patch(
    '/api/v1/config/runtime-defaults/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await service.updateDefault(
          request.auth!.tenantId,
          params.id,
          request.body as UpdateRuntimeDefaultInput,
        ),
      };
    },
  );

  app.delete(
    '/api/v1/config/runtime-defaults/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      await service.deleteDefault(request.auth!.tenantId, params.id);
      reply.status(204);
    },
  );
};
