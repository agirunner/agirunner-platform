import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import {
  createWorkflowDocument,
  deleteWorkflowDocument,
  listWorkflowDocuments,
  updateWorkflowDocument,
} from '../../../services/document-reference/document-reference-service.js';
import {
  parseOrThrow,
  runIdempotentTransactionalWorkflowAction,
  runIdempotentWorkflowAction,
  stageGateSchema,
  workflowBulkDeleteSchema,
  workflowChainSchema,
  workflowControlMutationSchema,
  workflowDocumentCreateSchema,
  workflowDocumentDeleteQuerySchema,
  workflowDocumentUpdateSchema,
  type WorkflowRoutesContext,
} from './shared.js';

export function registerWorkflowDocumentAndControlRoutes(context: WorkflowRoutesContext) {
  const {
    app,
    workflowService,
    workflowChainingService,
    approvalQueueService,
    toolResultService,
    playbookControlService,
  } = context;

  app.post(
    '/api/v1/workflows/:id/gates/:gateId',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string; gateId: string };
      const body = parseOrThrow(stageGateSchema.safeParse(request.body));
      await approvalQueueService.getGate(request.auth!.tenantId, params.gateId, params.id);
      const { request_id: requestId, ...decision } = body;
      const gate = await runIdempotentTransactionalWorkflowAction(
        app,
        toolResultService,
        request.auth!.tenantId,
        params.id,
        'act_on_gate',
        requestId,
        (client) =>
          playbookControlService.actOnGate(request.auth!, params.gateId, decision, client),
      );
      return { data: gate };
    },
  );

  app.get(
    '/api/v1/workflows/:id/documents',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const documents = await listWorkflowDocuments(app.pgPool, request.auth!.tenantId, params.id);
      return { data: documents };
    },
  );

  app.post(
    '/api/v1/workflows/:id/documents',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowDocumentCreateSchema.safeParse(request.body));
      const { request_id: requestId, ...input } = body;
      const document = await runIdempotentTransactionalWorkflowAction(
        app,
        toolResultService,
        request.auth!.tenantId,
        params.id,
        'operator_create_workflow_document',
        requestId,
        (client) => createWorkflowDocument(client, request.auth!.tenantId, params.id, input),
      );
      return reply.status(201).send({ data: document });
    },
  );

  app.patch(
    '/api/v1/workflows/:id/documents/:logicalName',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string; logicalName: string };
      const body = parseOrThrow(workflowDocumentUpdateSchema.safeParse(request.body));
      const { request_id: requestId, ...input } = body;
      return {
        data: await runIdempotentTransactionalWorkflowAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'operator_update_workflow_document',
          requestId,
          (client) =>
            updateWorkflowDocument(
              client,
              request.auth!.tenantId,
              params.id,
              decodeURIComponent(params.logicalName),
              input,
            ),
        ),
      };
    },
  );

  app.delete(
    '/api/v1/workflows/:id/documents/:logicalName',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string; logicalName: string };
      const query = parseOrThrow(workflowDocumentDeleteQuerySchema.safeParse(request.query ?? {}));
      await runIdempotentTransactionalWorkflowAction(
        app,
        toolResultService,
        request.auth!.tenantId,
        params.id,
        'operator_delete_workflow_document',
        query.request_id,
        async (client) => {
          await deleteWorkflowDocument(
            client,
            request.auth!.tenantId,
            params.id,
            decodeURIComponent(params.logicalName),
          );
          return { deleted: true };
        },
      );
      return reply.status(204).send();
    },
  );

  app.post(
    '/api/v1/workflows/:id/cancel',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowControlMutationSchema.safeParse(request.body ?? {}));
      return {
        data: await runIdempotentWorkflowAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'operator_cancel_workflow',
          body.request_id,
          () => workflowService.cancelWorkflow(request.auth!, params.id),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/pause',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowControlMutationSchema.safeParse(request.body ?? {}));
      return {
        data: await runIdempotentWorkflowAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'operator_pause_workflow',
          body.request_id,
          () => workflowService.pauseWorkflow(request.auth!, params.id),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/bulk-delete',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const body = parseOrThrow(workflowBulkDeleteSchema.safeParse(request.body ?? {}));
      return {
        data: await workflowService.deleteWorkflowsPermanently(
          request.auth!,
          body.workflow_ids,
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/resume',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowControlMutationSchema.safeParse(request.body ?? {}));
      return {
        data: await runIdempotentWorkflowAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'operator_resume_workflow',
          body.request_id,
          () => workflowService.resumeWorkflow(request.auth!, params.id),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/chain',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowChainSchema.safeParse(request.body ?? {}));
      const workflow = await workflowChainingService.chainWorkflowExplicit(
        request.auth!,
        params.id,
        body,
      );
      return reply.status(201).send({ data: workflow });
    },
  );

  app.delete(
    '/api/v1/workflows/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const result = await workflowService.deleteWorkflow(request.auth!, params.id);
      return { data: result };
    },
  );
}
