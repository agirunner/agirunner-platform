import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';

export const orchestratorConfigRoutes: FastifyPluginAsync = async (app) => {
  const service = app.orchestratorConfigService;

  app.get(
    '/api/v1/config/orchestrator',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({ data: await service.get(request.auth!.tenantId) }),
  );

  app.put(
    '/api/v1/config/orchestrator',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const body = request.body as { prompt?: string };
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      return { data: await service.upsert(request.auth!.tenantId, prompt) };
    },
  );
};
