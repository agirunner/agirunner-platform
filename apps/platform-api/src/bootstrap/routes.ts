import type { FastifyInstance } from 'fastify';

import { authRoutes } from '../api/routes/auth.routes.js';
import { healthRoutes } from '../api/routes/health.routes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(authRoutes);
}
