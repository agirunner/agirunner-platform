import type { FastifyInstance } from 'fastify';

import { agentRoutes } from '../api/routes/agents.routes.js';
import { authRoutes } from '../api/routes/auth.routes.js';
import { healthRoutes } from '../api/routes/health.routes.js';
import { pipelineRoutes } from '../api/routes/pipelines.routes.js';
import { taskRoutes } from '../api/routes/tasks.routes.js';
import { templateRoutes } from '../api/routes/templates.routes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(taskRoutes);
  await app.register(agentRoutes);
  await app.register(templateRoutes);
  await app.register(pipelineRoutes);
}
