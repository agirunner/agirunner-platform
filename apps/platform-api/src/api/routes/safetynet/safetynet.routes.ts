import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { listSafetynetEntries } from '../../../services/safetynet/registry.js';

export const safetynetRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/v1/system/safetynet-behaviors',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async () => ({
      data: listSafetynetEntries(),
    }),
  );
};
