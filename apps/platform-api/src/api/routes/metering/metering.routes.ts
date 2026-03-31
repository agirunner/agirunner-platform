import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { ValidationError } from '../../../errors/domain-errors.js';
import { MeteringService } from '../../../services/metering-service.js';

const recordSchema = z.object({
  taskId: z.string().uuid(),
  workflowId: z.string().uuid().optional(),
  workerId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  tokensInput: z.number().int().min(0).default(0),
  tokensOutput: z.number().int().min(0).default(0),
  costUsd: z.number().min(0).default(0),
  wallTimeMs: z.number().int().min(0).default(0),
  cpuMs: z.number().int().min(0).optional(),
  memoryPeakBytes: z.number().int().min(0).optional(),
  networkBytes: z.number().int().min(0).optional(),
});

export const meteringRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/v1/metering/events',
    { preHandler: [authenticateApiKey, withScope('worker')] },
    async (request) => {
      const body = recordSchema.parse(request.body);
      const service = new MeteringService(app.pgPool);
      const event = await service.record(request.auth!.tenantId, body);
      if (body.workflowId) {
        await app.workflowService.evaluateWorkflowBudget(request.auth!.tenantId, body.workflowId);
      }
      return event;
    },
  );

  app.get(
    '/api/v1/metering/events',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const query = request.query as {
        from?: string;
        to?: string;
        workflow_id?: string;
        worker_id?: string;
      };

      if (query.from && isNaN(Date.parse(query.from))) {
        throw new ValidationError('Invalid from date');
      }
      if (query.to && isNaN(Date.parse(query.to))) {
        throw new ValidationError('Invalid to date');
      }

      const service = new MeteringService(app.pgPool);
      return service.query(request.auth!.tenantId, {
        from: query.from,
        to: query.to,
        workflowId: query.workflow_id,
        workerId: query.worker_id,
      });
    },
  );

  app.get(
    '/api/v1/metering/summary',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const query = request.query as {
        from?: string;
        to?: string;
        workflow_id?: string;
      };

      if (query.from && isNaN(Date.parse(query.from))) {
        throw new ValidationError('Invalid from date');
      }
      if (query.to && isNaN(Date.parse(query.to))) {
        throw new ValidationError('Invalid to date');
      }

      const service = new MeteringService(app.pgPool);
      return service.summarize(request.auth!.tenantId, {
        from: query.from,
        to: query.to,
        workflowId: query.workflow_id,
      });
    },
  );
};
