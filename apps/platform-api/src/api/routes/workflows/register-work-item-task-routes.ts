import { authenticateApiKey, withAllowedScopes, withScope } from '../../../auth/fastify-auth-hook.js';
import { runIdempotentWorkflowBackedTaskAction } from '../task-platform/route-idempotency.js';
import {
  assertTaskBelongsToWorkflowTask,
  assertTaskBelongsToWorkflowWorkItem,
  parseOrThrow,
  workflowWorkItemTaskAgentEscalateSchema,
  workflowWorkItemTaskMutationSchema,
  workflowWorkItemTaskOutputOverrideSchema,
  workflowWorkItemTaskReassignSchema,
  workflowWorkItemTaskRejectSchema,
  workflowWorkItemTaskRequestChangesSchema,
  workflowWorkItemTaskResolveEscalationSchema,
  workflowWorkItemTaskRetrySchema,
  workflowWorkItemTaskSkipSchema,
  type WorkflowRoutesContext,
} from './shared.js';

export function registerWorkflowWorkItemTaskRoutes(context: WorkflowRoutesContext) {
  const { app, toolResultService, workflowWorkItemTaskMutationPreHandler } = context;

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/tasks/:taskId/reassign',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string; taskId: string };
      const body = parseOrThrow(workflowWorkItemTaskReassignSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      await assertTaskBelongsToWorkflowWorkItem(
        app,
        request.auth!.tenantId,
        params.id,
        params.workItemId,
        params.taskId,
      );
      return {
        data: await runIdempotentWorkflowBackedTaskAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'public_work_item_reassign',
          requestId,
          (client) => app.taskService.reassignTask(request.auth!, params.taskId, payload, client),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/tasks/:taskId/approve',
    { preHandler: workflowWorkItemTaskMutationPreHandler },
    async (request) => {
      const params = request.params as { id: string; workItemId: string; taskId: string };
      const body = parseOrThrow(workflowWorkItemTaskMutationSchema.safeParse(request.body ?? {}));
      await assertTaskBelongsToWorkflowWorkItem(
        app,
        request.auth!.tenantId,
        params.id,
        params.workItemId,
        params.taskId,
      );
      return {
        data: await runIdempotentWorkflowBackedTaskAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'public_task_approve',
          body.request_id,
          (client) => app.taskService.approveTask(request.auth!, params.taskId, client),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/tasks/:taskId/approve-output',
    { preHandler: workflowWorkItemTaskMutationPreHandler },
    async (request) => {
      const params = request.params as { id: string; workItemId: string; taskId: string };
      const body = parseOrThrow(workflowWorkItemTaskMutationSchema.safeParse(request.body ?? {}));
      await assertTaskBelongsToWorkflowWorkItem(
        app,
        request.auth!.tenantId,
        params.id,
        params.workItemId,
        params.taskId,
      );
      return {
        data: await runIdempotentWorkflowBackedTaskAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'public_task_approve_output',
          body.request_id,
          (client) => app.taskService.approveTaskOutput(request.auth!, params.taskId, client),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/tasks/:taskId/reject',
    { preHandler: workflowWorkItemTaskMutationPreHandler },
    async (request) => {
      const params = request.params as { id: string; workItemId: string; taskId: string };
      const body = parseOrThrow(workflowWorkItemTaskRejectSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      await assertTaskBelongsToWorkflowWorkItem(
        app,
        request.auth!.tenantId,
        params.id,
        params.workItemId,
        params.taskId,
      );
      return {
        data: await runIdempotentWorkflowBackedTaskAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'public_task_reject',
          requestId,
          () => app.taskService.rejectTask(request.auth!, params.taskId, payload),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/tasks/:taskId/request-changes',
    { preHandler: workflowWorkItemTaskMutationPreHandler },
    async (request) => {
      const params = request.params as { id: string; workItemId: string; taskId: string };
      const body = parseOrThrow(workflowWorkItemTaskRequestChangesSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      await assertTaskBelongsToWorkflowWorkItem(
        app,
        request.auth!.tenantId,
        params.id,
        params.workItemId,
        params.taskId,
      );
      return {
        data: await runIdempotentWorkflowBackedTaskAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'public_task_request_changes',
          requestId,
          (client) =>
            app.taskService.requestTaskChanges(request.auth!, params.taskId, payload, client),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/tasks/:taskId/retry',
    { preHandler: workflowWorkItemTaskMutationPreHandler },
    async (request) => {
      const params = request.params as { id: string; workItemId: string; taskId: string };
      const body = parseOrThrow(workflowWorkItemTaskRetrySchema.safeParse(request.body ?? {}));
      const { request_id: requestId, ...payload } = body;
      await assertTaskBelongsToWorkflowWorkItem(
        app,
        request.auth!.tenantId,
        params.id,
        params.workItemId,
        params.taskId,
      );
      return {
        data: await runIdempotentWorkflowBackedTaskAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'public_task_retry',
          requestId,
          (client) => app.taskService.retryTask(request.auth!, params.taskId, payload, client),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/tasks/:taskId/skip',
    { preHandler: workflowWorkItemTaskMutationPreHandler },
    async (request) => {
      const params = request.params as { id: string; workItemId: string; taskId: string };
      const body = parseOrThrow(workflowWorkItemTaskSkipSchema.safeParse(request.body ?? {}));
      const { request_id: requestId, ...payload } = body;
      await assertTaskBelongsToWorkflowWorkItem(
        app,
        request.auth!.tenantId,
        params.id,
        params.workItemId,
        params.taskId,
      );
      return {
        data: await runIdempotentWorkflowBackedTaskAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'public_task_skip',
          requestId,
          () => app.taskService.skipTask(request.auth!, params.taskId, payload),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/tasks/:taskId/cancel',
    { preHandler: workflowWorkItemTaskMutationPreHandler },
    async (request) => {
      const params = request.params as { id: string; workItemId: string; taskId: string };
      const body = parseOrThrow(workflowWorkItemTaskMutationSchema.safeParse(request.body ?? {}));
      await assertTaskBelongsToWorkflowWorkItem(
        app,
        request.auth!.tenantId,
        params.id,
        params.workItemId,
        params.taskId,
      );
      return {
        data: await runIdempotentWorkflowBackedTaskAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'public_task_cancel',
          body.request_id,
          (client) => app.taskService.cancelTask(request.auth!, params.taskId, client),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/tasks/:taskId/resolve-escalation',
    { preHandler: workflowWorkItemTaskMutationPreHandler },
    async (request) => {
      const params = request.params as { id: string; workItemId: string; taskId: string };
      const body = parseOrThrow(
        workflowWorkItemTaskResolveEscalationSchema.safeParse(request.body),
      );
      const { request_id: requestId, ...payload } = body;
      await assertTaskBelongsToWorkflowWorkItem(
        app,
        request.auth!.tenantId,
        params.id,
        params.workItemId,
        params.taskId,
      );
      return {
        data: await runIdempotentWorkflowBackedTaskAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'public_task_resolve_escalation',
          requestId,
          () => app.taskService.resolveEscalation(request.auth!, params.taskId, payload),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/tasks/:taskId/agent-escalate',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'worker', 'agent'])] },
    async (request) => {
      const params = request.params as { id: string; taskId: string };
      const body = parseOrThrow(
        workflowWorkItemTaskAgentEscalateSchema.safeParse(request.body),
      );
      const { request_id: requestId, ...payload } = body;
      await assertTaskBelongsToWorkflowTask(app, request.auth!.tenantId, params.id, params.taskId);
      return {
        data: await runIdempotentWorkflowBackedTaskAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'public_task_agent_escalate',
          requestId,
          () => app.taskService.agentEscalate(request.auth!, params.taskId, payload),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/tasks/:taskId/agent-escalate',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'worker', 'agent'])] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string; taskId: string };
      const body = parseOrThrow(
        workflowWorkItemTaskAgentEscalateSchema.safeParse(request.body),
      );
      const { request_id: requestId, ...payload } = body;
      await assertTaskBelongsToWorkflowWorkItem(
        app,
        request.auth!.tenantId,
        params.id,
        params.workItemId,
        params.taskId,
      );
      return {
        data: await runIdempotentWorkflowBackedTaskAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'public_task_agent_escalate',
          requestId,
          () => app.taskService.agentEscalate(request.auth!, params.taskId, payload),
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/work-items/:workItemId/tasks/:taskId/output-override',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string; taskId: string };
      const body = parseOrThrow(
        workflowWorkItemTaskOutputOverrideSchema.safeParse(request.body),
      );
      const { request_id: requestId, ...payload } = body;
      await assertTaskBelongsToWorkflowWorkItem(
        app,
        request.auth!.tenantId,
        params.id,
        params.workItemId,
        params.taskId,
      );
      return {
        data: await runIdempotentWorkflowBackedTaskAction(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'public_task_output_override',
          requestId,
          () =>
            app.taskService.overrideTaskOutput(request.auth!, params.taskId, {
              output: payload.output,
              reason: payload.reason,
            }),
        ),
      };
    },
  );
}
