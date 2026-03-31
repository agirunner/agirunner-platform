import type { FastifyPluginAsync } from 'fastify';

import { registerTaskOperatorRoutes } from './tasks/operator-routes.js';
import { registerTaskPublicRoutes } from './tasks/public-routes.js';

export const taskRoutes: FastifyPluginAsync = async (app) => {
  await registerTaskPublicRoutes(app);
  await registerTaskOperatorRoutes(app);
};
