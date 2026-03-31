import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { ConflictError, ValidationError } from '../../../errors/domain-errors.js';
import { runIdempotentWorkflowBackedTaskAction } from '../task-route-idempotency.js';
import {
  mapWorkItemCreateBody,
  parseOrThrow,
  runIdempotentTransactionalWorkflowAction,
  runIdempotentWorkflowAction,
  selectWorkflowWorkItemRecoveryTask,
  workItemCreateSchema,
  workflowControlMutationSchema,
  workflowWorkItemTaskRetrySchema,
  workflowWorkItemTaskSkipSchema,
  workItemResolveEscalationSchema,
  workItemUpdateSchema,
  type WorkflowRoutesContext,
} from './shared.js';

export function registerWorkflowWorkItemRoutes(context: WorkflowRoutesContext) {
  const {
    app,
    workflowService,
    handoffService,
    toolResultService,
    workflowWorkItemTaskMutationPreHandler,
  } = context;

  app.get(
    '/api/v1/workflows/:id/work-items',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as {
        parent_work_item_id?: string;
        stage_name?: string;
        column_id?: string;
        grouped?: string;
      };
      const grouped = query.grouped === 'true';
      return {
        data: await workflowService.listWorkflowWorkItems(
          request.auth!.tenantId,
          params.id,
          grouped
            ? {
                parent_work_item_id: query.parent_work_item_id,
                stage_name: query.stage_name,
                column_id: query.column_id,
                grouped: true,
              }
            : {
                parent_work_item_id: query.parent_work_item_id,
                stage_name: query.stage_name,
                column_id: query.column_id,
              },
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workItemCreateSchema.safeParse(request.body));
      const workItem = await runIdempotentTransactionalWorkflowAction(
        app,
        toolResultService,
        request.auth!.tenantId,
        params.id,
        'operator_create_workflow_work_item',
        body.request_id,
        (client) => workflowService.createWorkflowWorkItem(
          request.auth!,
          params.id,
          mapWorkItemCreateBody(body),
          client,
        ),
      );
      return reply.status(201).send({ data: workItem });
    },
  );

  app.get(
    '/api/v1/workflows/:id/work-items/:workItemId',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      const query = request.query as { include_children?: string };
      const includeChildren = query.include_children === 'true';
      return {
        data: await workflowService.getWorkflowWorkItem(
          request.auth!.tenantId,
          params.id,
          params.workItemId,
          includeChildren ? { include_children: true } : undefined,
        ),
      };
    },
  );

  app.get(
    '/api/v1/workflows/:id/work-items/:workItemId/tasks',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      return {
        data: await workflowService.listWorkflowWorkItemTasks(
          request.auth!.tenantId,
          params.id,
          params.workItemId,
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/retry',
    { preHandler: workflowWorkItemTaskMutationPreHandler },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      const body = parseOrThrow(workflowWorkItemTaskRetrySchema.safeParse(request.body ?? {}));
      const tasks = (await workflowService.listWorkflowWorkItemTasks(
        request.auth!.tenantId,
        params.id,
        params.workItemId,
      )) as Record<string, unknown>[];
      const selectedTask = selectWorkflowWorkItemRecoveryTask(tasks);
      const selectedTaskId = selectedTask?.id;
      if (!selectedTask || typeof selectedTaskId !== 'string') {
        throw new ConflictError('No recovery step found for this work item');
      }

      const force = body.force ?? String(selectedTask.state).toLowerCase() !== 'failed';
      return {
        data: await runIdempotentWorkflowBackedTaskAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'public_work_item_retry',
          body.request_id,
          (client) =>
            app.taskService.retryTask(
              request.auth!,
              selectedTaskId,
              { override_input: body.override_input, force },
              client,
            ),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/skip',
    { preHandler: workflowWorkItemTaskMutationPreHandler },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      const body = parseOrThrow(workflowWorkItemTaskSkipSchema.safeParse(request.body ?? {}));
      const tasks = (await workflowService.listWorkflowWorkItemTasks(
        request.auth!.tenantId,
        params.id,
        params.workItemId,
      )) as Record<string, unknown>[];
      const selectedTask = selectWorkflowWorkItemRecoveryTask(tasks);
      const selectedTaskId = selectedTask?.id;
      if (!selectedTask || typeof selectedTaskId !== 'string') {
        throw new ConflictError('No recovery step found for this work item');
      }

      return {
        data: await runIdempotentWorkflowBackedTaskAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'public_work_item_skip',
          body.request_id,
          () => app.taskService.skipTask(request.auth!, selectedTaskId, { reason: body.reason }),
        ),
      };
    },
  );

  app.get(
    '/api/v1/workflows/:id/work-items/:workItemId/events',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      const query = request.query as { limit?: string; per_page?: string };
      const limitRaw = query.limit ?? query.per_page;
      const limit = limitRaw === undefined ? 100 : Number(limitRaw);
      if (!Number.isFinite(limit) || limit <= 0 || limit > 500) {
        throw new ValidationError('limit must be a positive integer <= 500');
      }
      return {
        data: await workflowService.listWorkflowWorkItemEvents(
          request.auth!.tenantId,
          params.id,
          params.workItemId,
          limit,
        ),
      };
    },
  );

  app.get(
    '/api/v1/workflows/:id/work-items/:workItemId/handoffs',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      return {
        data: await handoffService.listWorkItemHandoffs(
          request.auth!.tenantId,
          params.id,
          params.workItemId,
        ),
      };
    },
  );

  app.get(
    '/api/v1/workflows/:id/work-items/:workItemId/handoffs/latest',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      return {
        data: await handoffService.getLatestWorkItemHandoff(
          request.auth!.tenantId,
          params.id,
          params.workItemId,
        ),
      };
    },
  );

  app.get(
    '/api/v1/workflows/:id/work-items/:workItemId/memory',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      return {
        data: await workflowService.getWorkflowWorkItemMemory(
          request.auth!.tenantId,
          params.id,
          params.workItemId,
        ),
      };
    },
  );

  app.get(
    '/api/v1/workflows/:id/work-items/:workItemId/memory/history',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      const query = request.query as { limit?: string };
      const limit = query.limit === undefined ? 100 : Number(query.limit);
      if (!Number.isFinite(limit) || limit <= 0 || limit > 500) {
        throw new ValidationError('limit must be a positive integer <= 500');
      }
      return {
        data: await workflowService.getWorkflowWorkItemMemoryHistory(
          request.auth!.tenantId,
          params.id,
          params.workItemId,
          limit,
        ),
      };
    },
  );

  app.patch(
    '/api/v1/workflows/:id/work-items/:workItemId',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      const body = parseOrThrow(workItemUpdateSchema.safeParse(request.body));
      const { request_id: requestId, ...input } = body;
      return {
        data: await runIdempotentTransactionalWorkflowAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'operator_update_workflow_work_item',
          requestId,
          (client) =>
            workflowService.updateWorkflowWorkItem(
              request.auth!,
              params.id,
              params.workItemId,
              input,
              client,
            ),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/resolve-escalation',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      const body = parseOrThrow(workItemResolveEscalationSchema.safeParse(request.body));
      const { request_id: requestId, ...input } = body;
      return {
        data: await runIdempotentTransactionalWorkflowAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'operator_resolve_work_item_escalation',
          requestId,
          (client) =>
            workflowService.resolveWorkflowWorkItemEscalation(
              request.auth!,
              params.id,
              params.workItemId,
              input,
              client,
            ),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/pause',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      const body = parseOrThrow(workflowControlMutationSchema.safeParse(request.body ?? {}));
      return {
        data: await runIdempotentWorkflowAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'operator_pause_workflow_work_item',
          body.request_id,
          () => workflowService.pauseWorkflowWorkItem(request.auth!, params.id, params.workItemId),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/resume',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      const body = parseOrThrow(workflowControlMutationSchema.safeParse(request.body ?? {}));
      return {
        data: await runIdempotentWorkflowAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'operator_resume_workflow_work_item',
          body.request_id,
          () => workflowService.resumeWorkflowWorkItem(request.auth!, params.id, params.workItemId),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/cancel',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      const body = parseOrThrow(workflowControlMutationSchema.safeParse(request.body ?? {}));
      return {
        data: await runIdempotentWorkflowAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'operator_cancel_workflow_work_item',
          body.request_id,
          () => workflowService.cancelWorkflowWorkItem(request.auth!, params.id, params.workItemId),
        ),
      };
    },
  );
}
