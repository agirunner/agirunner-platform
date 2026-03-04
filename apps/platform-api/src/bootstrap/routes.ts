import type { FastifyInstance } from 'fastify';

import { agentRoutes } from '../api/routes/agents.routes.js';
import { authRoutes } from '../api/routes/auth.routes.js';
import { eventRoutes } from '../api/routes/events.routes.js';
import { executeRoutes } from '../api/routes/execute.routes.js';
import { healthRoutes } from '../api/routes/health.routes.js';
import { pipelineRoutes } from '../api/routes/pipelines.routes.js';
import { taskRoutes } from '../api/routes/tasks.routes.js';
import { templateRoutes } from '../api/routes/templates.routes.js';
import { webhookRoutes } from '../api/routes/webhooks.routes.js';
import { workerRoutes } from '../api/routes/workers.routes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(taskRoutes);
  await app.register(executeRoutes);
  await app.register(agentRoutes);
  await app.register(workerRoutes);
  await app.register(eventRoutes);
  await app.register(webhookRoutes);
  await app.register(templateRoutes);
  await app.register(pipelineRoutes);
}
