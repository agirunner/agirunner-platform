import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import type {
  CreateSpecialistSkillInput,
  UpdateSpecialistSkillInput,
} from '../../../services/specialist/specialist-skill-service.js';

export const specialistSkillRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/v1/specialist-skills',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({
      data: await app.specialistSkillService.listSkills(request.auth!.tenantId),
    }),
  );

  app.get(
    '/api/v1/specialist-skills/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.specialistSkillService.getSkill(request.auth!.tenantId, params.id),
      };
    },
  );

  app.post(
    '/api/v1/specialist-skills',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const result = await app.specialistSkillService.createSkill(
        request.auth!.tenantId,
        request.body as CreateSpecialistSkillInput,
      );
      reply.status(201);
      return { data: result };
    },
  );

  app.put(
    '/api/v1/specialist-skills/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.specialistSkillService.updateSkill(
          request.auth!.tenantId,
          params.id,
          request.body as UpdateSpecialistSkillInput,
        ),
      };
    },
  );

  app.delete(
    '/api/v1/specialist-skills/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      await app.specialistSkillService.deleteSkill(request.auth!.tenantId, params.id);
      reply.status(204);
      return null;
    },
  );
};
