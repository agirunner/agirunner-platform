import type { FastifyPluginAsync } from 'fastify';

import { registerTaskOperatorRoutes } from './tasks.routes/operator-routes.js';
import { registerTaskPublicRoutes } from './tasks.routes/public-routes.js';

export const taskRoutes: FastifyPluginAsync = async (app) => {
  await registerTaskPublicRoutes(app);
  await registerTaskOperatorRoutes(app);
};
