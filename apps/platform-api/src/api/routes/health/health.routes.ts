import type { FastifyPluginAsync } from 'fastify';

import { metricsRegistry } from '../../../observability/metrics.js';
import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/health/detail', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => ({
    status: 'ok',
    uptime_seconds: Math.round(process.uptime()),
    database: 'connected',
    tenant_id: request.auth?.tenantId,
  }));

  app.get('/metrics', { preHandler: [authenticateApiKey, withScope('admin')] }, async (_request, reply) => {
    const content = await metricsRegistry.metrics();
    return reply
      .header('content-type', metricsRegistry.contentType)
      .status(200)
      .send(content);
  });
};
