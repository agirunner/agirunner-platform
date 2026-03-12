import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { ApprovalQueueService } from '../../services/approval-queue-service.js';
import { PlaybookWorkflowControlService } from '../../services/playbook-workflow-control-service.js';
import { WorkflowActivationDispatchService } from '../../services/workflow-activation-dispatch-service.js';
import { WorkflowActivationService } from '../../services/workflow-activation-service.js';
import { WorkflowStateService } from '../../services/workflow-state-service.js';

const gateDecisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'request_changes']),
  feedback: z.string().min(1).max(4000).optional(),
});

export const approvalQueueRoutes: FastifyPluginAsync = async (app) => {
  const approvalQueueService = new ApprovalQueueService(app.pgPool);
  const playbookControlService = new PlaybookWorkflowControlService({
    pool: app.pgPool,
    eventService: app.eventService,
    stateService: new WorkflowStateService(app.pgPool, app.eventService),
    activationService: new WorkflowActivationService(app.pgPool, app.eventService),
    activationDispatchService: new WorkflowActivationDispatchService({
      pool: app.pgPool,
      eventService: app.eventService,
      config: app.config,
    }),
  });

  app.get('/api/v1/approvals', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    return {
      data: await approvalQueueService.listApprovals(request.auth!.tenantId),
    };
  });

  app.get('/api/v1/approvals/:gateId', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { gateId: string };
    return {
      data: await approvalQueueService.getGate(request.auth!.tenantId, params.gateId),
    };
  });

  app.post('/api/v1/approvals/:gateId', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { gateId: string };
    const body = gateDecisionSchema.parse(request.body);
    return {
      data: await playbookControlService.actOnGate(request.auth!, params.gateId, body),
    };
  });
};
