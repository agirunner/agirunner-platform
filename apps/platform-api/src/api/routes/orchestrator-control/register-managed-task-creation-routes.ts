import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';

import type { OrchestratorControlRouteContext } from './route-context.js';
import {
  isRecoverableNotAppliedResult,
  loadManagedSpecialistTaskOrRecoverableNoop,
  parseOrThrow,
  parseUuidParamOrThrow,
  runIdempotentMutation,
} from './shared.js';
import {
  orchestratorTaskCreateSchema,
  orchestratorTaskInputUpdateSchema,
  orchestratorTaskMessageSchema,
} from './schemas.js';
import {
  buildRecoverableCreateTaskNoopIfAssessmentRequestAlreadyApplied,
  buildRecoverableCreateTaskNoopIfNotReady,
  loadExistingReviewTaskForSameRevision,
  loadExistingReworkTaskForAssessmentRequest,
  loadOrchestratorCreateWorkItemContext,
  normalizeOrchestratorTaskCreateInput,
} from './task-normalization.js';
import { normalizeManagedTaskMessageResult } from './managed-task-message-recovery.js';

export function registerOrchestratorManagedTaskCreationRoutes(
  context: OrchestratorControlRouteContext,
): void {
  const {
    app,
    taskMessageService,
    taskScopeService,
    toolResultService,
  } = context;

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(orchestratorTaskCreateSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const taskBody = await normalizeOrchestratorTaskCreateInput(
        app.pgPool,
        request.auth!.tenantId,
        taskScope,
        body,
      );
      const createTaskContext = await loadOrchestratorCreateWorkItemContext(
        app.pgPool,
        request.auth!.tenantId,
        taskScope.workflow_id,
        taskScope.activation_id,
      );
      const task = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'create_task',
        body.request_id,
        async (client) => {
          const createInput = {
            ...taskBody,
            workflow_id: taskScope.workflow_id,
            workspace_id: taskScope.workspace_id ?? undefined,
            activation_id: taskScope.activation_id ?? undefined,
            is_orchestrator_task: false,
            metadata: {
              ...(taskBody.metadata ?? {}),
              created_by_orchestrator_task_id: taskScope.id,
              orchestrator_activation_id: taskScope.activation_id,
            },
          };

          const existingReworkTaskId = await loadExistingReworkTaskForAssessmentRequest(
            client,
            request.auth!.tenantId,
            taskScope.workflow_id,
            createTaskContext,
            createInput,
          );
          if (existingReworkTaskId) {
            return app.taskService.getTask(request.auth!.tenantId, existingReworkTaskId) as Promise<Record<string, unknown>>;
          }

          const existingReviewTaskId = await loadExistingReviewTaskForSameRevision(
            client,
            request.auth!.tenantId,
            taskScope.workflow_id,
            createInput,
          );
          if (existingReviewTaskId) {
            return app.taskService.getTask(request.auth!.tenantId, existingReviewTaskId) as Promise<Record<string, unknown>>;
          }

          const duplicateAppliedAssessmentRequestNoop =
            await buildRecoverableCreateTaskNoopIfAssessmentRequestAlreadyApplied(
              client,
              request.auth!.tenantId,
              taskScope.workflow_id,
              taskScope,
              createTaskContext,
              createInput,
            );
          if (duplicateAppliedAssessmentRequestNoop) {
            return duplicateAppliedAssessmentRequestNoop;
          }

          const verificationNotReadyNoop = await buildRecoverableCreateTaskNoopIfNotReady(
            client,
            request.auth!.tenantId,
            taskScope.workflow_id,
            taskScope,
            createInput,
          );
          if (verificationNotReadyNoop) {
            return verificationNotReadyNoop;
          }

          return app.taskService.createTask(request.auth!, createInput, client);
        },
      );
      return reply.status(isRecoverableNotAppliedResult(task) ? 200 : 201).send({ data: task });
    },
  );

  app.patch(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/input',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskInputUpdateSchema.safeParse(request.body));
      const managedTaskId = parseUuidParamOrThrow(params.managedTaskId, 'managed task id');
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'update_task_input',
        body.request_id,
        async (client) => {
          const managedTask = await loadManagedSpecialistTaskOrRecoverableNoop(
            app,
            request.auth!,
            taskScope,
            managedTaskId,
          );
          if (isRecoverableNotAppliedResult(managedTask)) {
            return managedTask;
          }
          return app.taskService.updateTaskInput(
            request.auth!.tenantId,
            managedTaskId,
            body.input,
            client,
          );
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/message',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskMessageSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'send_task_message',
        body.request_id,
        (client) =>
          taskMessageService.prepareMessage(
            request.auth!,
            taskScope,
            params.managedTaskId,
            body,
            client,
          ),
      );
      const delivered =
        (await taskMessageService.deliverPendingByRequestId(
          request.auth!,
          taskScope.workflow_id,
          body.request_id,
        )) ?? stored;
      const normalizedResult = normalizeManagedTaskMessageResult(
        taskScope,
        params.managedTaskId,
        delivered,
      );
      const finalResponse = await toolResultService.replaceResult(
        request.auth!.tenantId,
        taskScope.workflow_id,
        'send_task_message',
        body.request_id,
        normalizedResult,
      );
      return { data: finalResponse };
    },
  );
}
