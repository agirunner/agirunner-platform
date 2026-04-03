import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import type { ApiKeyIdentity } from '../../../auth/api-key.js';

import type { OrchestratorControlRouteContext } from './route-context.js';
import {
  buildRecoverableApproveTaskNoop,
  buildRecoverableRequestReworkNoop,
  isRecoverableNotAppliedResult,
  loadManagedSpecialistTask,
  loadManagedSpecialistTaskOrRecoverableNoop,
  parseOrThrow,
  parseUuidParamOrThrow,
  runIdempotentMutation,
} from './shared.js';
import {
  orchestratorTaskEscalateSchema,
  orchestratorTaskMutationSchema,
  orchestratorTaskReassignSchema,
  orchestratorTaskRetrySchema,
  orchestratorTaskReworkSchema,
  reattachOrReplaceStaleOwnerSchema,
  rerunTaskWithCorrectedBriefSchema,
} from './schemas.js';

export function registerOrchestratorManagedTaskControlRoutes(
  context: OrchestratorControlRouteContext,
): void {
  const {
    app,
    artifactService,
    recoveryHelpers,
    taskScopeService,
    toolResultService,
  } = context;

  const loadReadableManagedTask = async (
    identity: ApiKeyIdentity,
    orchestratorTaskId: string,
    managedTaskId: string,
  ) => {
    const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(identity, orchestratorTaskId);
    if (managedTaskId === orchestratorTaskId) {
      const task = await app.taskService.getTask(identity.tenantId, managedTaskId);
      return { taskScope, task };
    }
    const task = await loadManagedSpecialistTask(
      app,
      identity,
      taskScope.workflow_id,
      managedTaskId,
    );
    return { taskScope, task };
  };

  app.get(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const { task } = await loadReadableManagedTask(
        request.auth!,
        params.taskId,
        params.managedTaskId,
      );
      const artifacts = await artifactService.listTaskArtifacts(
        request.auth!.tenantId,
        params.managedTaskId,
      );
      return {
        data: {
          ...task,
          artifacts,
        },
      };
    },
  );

  app.get(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/artifacts',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      await loadReadableManagedTask(
        request.auth!,
        params.taskId,
        params.managedTaskId,
      );
      const artifacts = await artifactService.listTaskArtifacts(
        request.auth!.tenantId,
        params.managedTaskId,
      );
      return { data: artifacts };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/approve',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskMutationSchema.safeParse(request.body));
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
        'approve_task',
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
          const noop = buildRecoverableApproveTaskNoop(taskScope, managedTask);
          if (noop) {
            return noop;
          }
          return app.taskService.approveTask(request.auth!, managedTaskId, client);
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/approve-output',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskMutationSchema.safeParse(request.body));
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
        'approve_task_output',
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
          return app.taskService.approveTaskOutput(request.auth!, managedTaskId, client);
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/rework',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskReworkSchema.safeParse(request.body));
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
        'request_rework',
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
          const noop = buildRecoverableRequestReworkNoop(taskScope, managedTask);
          if (noop) {
            return noop;
          }
          return app.taskService.requestTaskChanges(request.auth!, managedTaskId, body, client);
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/rerun-with-corrected-brief',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(rerunTaskWithCorrectedBriefSchema.safeParse(request.body));
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
        'rerun_task_with_corrected_brief',
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
          return recoveryHelpers.rerunTaskWithCorrectedBrief(
            request.auth!,
            managedTaskId,
            {
              request_id: body.request_id,
              corrected_input: body.corrected_input,
            },
            client,
          );
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/reattach-or-replace-stale-owner',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(reattachOrReplaceStaleOwnerSchema.safeParse(request.body));
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
        'reattach_or_replace_stale_owner',
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
          return recoveryHelpers.reattachOrReplaceStaleOwner(
            request.auth!,
            managedTaskId,
            body,
            client,
          );
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/retry',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskRetrySchema.safeParse(request.body ?? {}));
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
        'retry_task',
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
          return app.taskService.retryTask(request.auth!, managedTaskId, body, client);
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/cancel',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskMutationSchema.safeParse(request.body));
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
        'cancel_task',
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
          return app.taskService.cancelTask(request.auth!, managedTaskId, client);
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/reassign',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskReassignSchema.safeParse(request.body));
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
        'reassign_task',
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
          return app.taskService.reassignTask(request.auth!, managedTaskId, body, client);
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/escalate-to-human',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskEscalateSchema.safeParse(request.body));
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
        'escalate_to_human',
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
          return app.taskService.escalateTask(
            request.auth!,
            managedTaskId,
            {
              reason: body.reason,
              context: body.context,
              recommendation: body.recommendation,
              blocking_task_id: body.blocking_task_id,
              urgency: body.urgency,
              escalation_target: 'human',
            },
            client,
          );
        },
      );
      return { data: stored };
    },
  );
}
