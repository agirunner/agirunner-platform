import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { RuntimeConfigService } from '../../../services/runtime-config-service.js';

export const runtimeConfigRoutes: FastifyPluginAsync = async (app) => {
  const service = new RuntimeConfigService(app.pgPool);

  app.get(
    '/api/v1/runtime/config/:workerName',
    { preHandler: [authenticateApiKey, withScope('worker')] },
    async (request) => {
      const params = request.params as { workerName: string };
      const query = request.query as { playbookId?: string; poolKind?: string };
      return {
        data: await service.getConfigForWorker(request.auth!.tenantId, params.workerName, {
          playbookId: query.playbookId,
          poolKind: query.poolKind,
        }),
      };
    },
  );
};
