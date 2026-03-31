import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { ApprovalQueueService } from '../../../services/approval-queue-service/approval-queue-service.js';
import { PlaybookWorkflowControlService } from '../../../services/playbook-workflow-control/playbook-workflow-control-service.js';
import { WorkflowActivationDispatchService } from '../../../services/workflow-activation-dispatch-service.js';
import { WorkflowActivationService } from '../../../services/workflow-activation/workflow-activation-service.js';
import { WorkflowDeliverableService } from '../../../services/workflow-deliverable-service.js';
import { WorkflowStateService } from '../../../services/workflow-state-service.js';
import { WorkflowToolResultService } from '../../../services/workflow-tool-result-service.js';

const requestIdSchema = z.string().min(1).max(255);

const gateDecisionSchema = z.object({
  request_id: requestIdSchema,
  action: z.enum(['approve', 'reject', 'request_changes', 'block']),
  feedback: z.string().min(1).max(4000).optional(),
});

export const approvalQueueRoutes: FastifyPluginAsync = async (app) => {
  const approvalQueueService = new ApprovalQueueService(app.pgPool);
  const toolResultService = new WorkflowToolResultService(app.pgPool);
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
    subjectTaskChangeService: app.taskService,
    workflowDeliverableService: new WorkflowDeliverableService(app.pgPool),
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
    const gate = await approvalQueueService.getGate(request.auth!.tenantId, params.gateId);
    const { request_id: requestId, ...decision } = body;
    return {
      data: await runIdempotentGateDecision(
        app,
        toolResultService,
        request.auth!.tenantId,
        gate.workflow_id,
        'act_on_gate',
        requestId,
        (client) => playbookControlService.actOnGate(request.auth!, params.gateId, decision, client),
      ),
    };
  });
};

async function runIdempotentGateDecision<T extends Record<string, unknown>>(
  app: FastifyInstance,
  toolResultService: WorkflowToolResultService,
  tenantId: string,
  workflowId: string,
  toolName: string,
  requestId: string | undefined,
  run: (client: import('../../../db/database.js').DatabaseClient) => Promise<T>,
): Promise<T> {
  const normalizedRequestId = requestId?.trim();
  const client = await app.pgPool.connect();
  try {
    await client.query('BEGIN');
    if (normalizedRequestId) {
      await toolResultService.lockRequest(tenantId, workflowId, toolName, normalizedRequestId, client);
      const existing = await toolResultService.getResult(
        tenantId,
        workflowId,
        toolName,
        normalizedRequestId,
        client,
      );
      if (existing) {
        await client.query('COMMIT');
        return existing as T;
      }
    }

    const result = await run(client);
    if (normalizedRequestId) {
      const stored = await toolResultService.storeResult(
        tenantId,
        workflowId,
        toolName,
        normalizedRequestId,
        result,
        client,
      );
      await client.query('COMMIT');
      return stored as T;
    }

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
