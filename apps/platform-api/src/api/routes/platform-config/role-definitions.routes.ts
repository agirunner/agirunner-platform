import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import type {
  CreateRoleInput,
  UpdateRoleInput,
} from '../../../services/role-definition/role-definition-service.js';

export const roleDefinitionRoutes: FastifyPluginAsync = async (app) => {
  const service = app.roleDefinitionService;

  app.get(
    '/api/v1/config/roles',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const query = request.query as { activeOnly?: string };
      const activeOnly = query.activeOnly === 'true';
      return { data: await service.listRoles(request.auth!.tenantId, activeOnly) };
    },
  );

  app.get(
    '/api/v1/config/roles/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await service.getRoleById(request.auth!.tenantId, params.id) };
    },
  );

  app.post(
    '/api/v1/config/roles',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const result = await service.createRole(
        request.auth!.tenantId,
        request.body as CreateRoleInput,
      );
      reply.status(201);
      return { data: result };
    },
  );

  app.put(
    '/api/v1/config/roles/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await service.updateRole(
          request.auth!.tenantId,
          params.id,
          request.body as UpdateRoleInput,
        ),
      };
    },
  );

  app.delete(
    '/api/v1/config/roles/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      await service.deleteRole(request.auth!.tenantId, params.id);
      reply.status(204);
    },
  );
};
