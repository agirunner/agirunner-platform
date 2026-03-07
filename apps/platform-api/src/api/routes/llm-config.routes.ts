import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import {
  ModelCatalogService,
  type CreateProviderInput,
  type UpdateProviderInput,
  type CreateModelInput,
  type UpdateModelInput,
} from '../../services/model-catalog-service.js';

export const llmConfigRoutes: FastifyPluginAsync = async (app) => {
  const service = new ModelCatalogService(app.pgPool);

  // --- Providers ---

  app.get(
    '/api/v1/config/llm/providers',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({ data: await service.listProviders(request.auth!.tenantId) }),
  );

  app.get(
    '/api/v1/config/llm/providers/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await service.getProvider(request.auth!.tenantId, params.id) };
    },
  );

  app.post(
    '/api/v1/config/llm/providers',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const result = await service.createProvider(
        request.auth!.tenantId,
        request.body as CreateProviderInput,
      );
      reply.status(201);
      return { data: result };
    },
  );

  app.put(
    '/api/v1/config/llm/providers/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await service.updateProvider(
          request.auth!.tenantId,
          params.id,
          request.body as UpdateProviderInput,
        ),
      };
    },
  );

  app.delete(
    '/api/v1/config/llm/providers/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      await service.deleteProvider(request.auth!.tenantId, params.id);
      reply.status(204);
    },
  );

  // --- Models ---

  app.get(
    '/api/v1/config/llm/models',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const query = request.query as { providerId?: string };
      return { data: await service.listModels(request.auth!.tenantId, query.providerId) };
    },
  );

  app.get(
    '/api/v1/config/llm/models/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await service.getModel(request.auth!.tenantId, params.id) };
    },
  );

  app.post(
    '/api/v1/config/llm/models',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const result = await service.createModel(
        request.auth!.tenantId,
        request.body as CreateModelInput,
      );
      reply.status(201);
      return { data: result };
    },
  );

  app.put(
    '/api/v1/config/llm/models/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await service.updateModel(
          request.auth!.tenantId,
          params.id,
          request.body as UpdateModelInput,
        ),
      };
    },
  );

  app.delete(
    '/api/v1/config/llm/models/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      await service.deleteModel(request.auth!.tenantId, params.id);
      reply.status(204);
    },
  );

  // --- Role-Model Assignments ---

  app.get(
    '/api/v1/config/llm/assignments',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({ data: await service.listAssignments(request.auth!.tenantId) }),
  );

  app.put(
    '/api/v1/config/llm/assignments/:roleName',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { roleName: string };
      const body = request.body as { primaryModelId?: string | null; fallbackModelId?: string | null };
      return {
        data: await service.upsertAssignment(
          request.auth!.tenantId,
          params.roleName,
          body.primaryModelId ?? null,
          body.fallbackModelId ?? null,
        ),
      };
    },
  );
};
