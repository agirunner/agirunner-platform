import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import {
  FleetService,
  type CreateDesiredStateInput,
  type UpdateDesiredStateInput,
} from '../../services/fleet-service.js';

export const fleetRoutes: FastifyPluginAsync = async (app) => {
  const service = new FleetService(app.pgPool);

  // --- Desired State (Fleet Workers) ---

  app.get(
    '/api/v1/fleet/workers',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({ data: await service.listWorkers(request.auth!.tenantId) }),
  );

  app.post(
    '/api/v1/fleet/workers',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const result = await service.createWorker(
        request.auth!.tenantId,
        request.body as CreateDesiredStateInput,
      );
      reply.status(201);
      return { data: result };
    },
  );

  app.patch(
    '/api/v1/fleet/workers/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await service.updateWorker(
          request.auth!.tenantId,
          params.id,
          request.body as UpdateDesiredStateInput,
        ),
      };
    },
  );

  app.delete(
    '/api/v1/fleet/workers/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      await service.deleteWorker(request.auth!.tenantId, params.id);
      reply.status(204);
    },
  );

  app.post(
    '/api/v1/fleet/workers/:id/restart',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await service.restartWorker(request.auth!.tenantId, params.id) };
    },
  );

  app.post(
    '/api/v1/fleet/workers/:id/drain',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await service.drainWorker(request.auth!.tenantId, params.id) };
    },
  );

  // --- Containers ---

  app.get(
    '/api/v1/fleet/containers',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({ data: await service.listContainers(request.auth!.tenantId) }),
  );

  app.get(
    '/api/v1/fleet/containers/:id/stats',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await service.getContainerStats(params.id) };
    },
  );

  // --- Images ---

  app.get(
    '/api/v1/fleet/images',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async () => ({ data: await service.listImages() }),
  );
};
