import type { FastifyPluginAsync } from 'fastify';

import { registerTaskOperatorRoutes } from './operator-routes.js';
import { registerTaskPublicRoutes } from './public-routes.js';

export const taskRoutes: FastifyPluginAsync = async (app) => {
  await registerTaskPublicRoutes(app);
  await registerTaskOperatorRoutes(app);
};
