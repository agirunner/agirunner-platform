import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { CircuitBreakerService } from '../../services/circuit-breaker-service.js';

const reportSchema = z.object({
  workerId: z.string().uuid(),
  outcome: z.enum(['success', 'failure', 'timeout', 'error']),
  reason: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const circuitBreakerRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/v1/circuit-breaker/report',
    { preHandler: [authenticateApiKey, withScope('worker')] },
    async (request) => {
      const body = reportSchema.parse(request.body);
      const service = new CircuitBreakerService(app.pgPool);
      return service.reportOutcome(request.auth!.tenantId, body);
    },
  );

  app.get(
    '/api/v1/circuit-breaker/workers/:workerId',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const { workerId } = request.params as { workerId: string };
      const service = new CircuitBreakerService(app.pgPool);
      return service.getWorkerQuality(request.auth!.tenantId, workerId);
    },
  );

  app.get(
    '/api/v1/circuit-breaker/workers/:workerId/events',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const { workerId } = request.params as { workerId: string };
      const query = request.query as { limit?: string };
      const limit = query.limit ? Number(query.limit) : 50;
      const service = new CircuitBreakerService(app.pgPool);
      return service.listEvents(request.auth!.tenantId, workerId, limit);
    },
  );

  app.post(
    '/api/v1/circuit-breaker/workers/:workerId/reset',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const { workerId } = request.params as { workerId: string };
      const service = new CircuitBreakerService(app.pgPool);
      await service.resetCircuitBreaker(request.auth!.tenantId, workerId);
      return { status: 'reset' };
    },
  );
};
