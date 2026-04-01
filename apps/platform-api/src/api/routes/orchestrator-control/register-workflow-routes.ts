import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { ValidationError } from '../../../errors/domain-errors.js';
import { assertWorkspaceMemoryWritesAreDurableKnowledge } from '../../../services/workspace/memory/workspace-memory-write-guard.js';

import {
  isWorkflowCreateRequestConflict,
  loadExistingChildWorkflow,
  normalizeOrchestratorChildWorkflowLinkage,
} from './child-workflows.js';
import {
  advanceStageOrNoop,
  buildUnconfiguredGateApprovalAdvisory,
  completeWorkflowOrNoop,
} from './recoverable-mutations.js';
import type { OrchestratorControlRouteContext } from './route-context.js';
import {
  parseOrThrow,
  resolveContinuityWorkItemId,
  runIdempotentMutation,
} from './shared.js';
import {
  childWorkflowCreateSchema,
  gateRequestSchema,
  orchestratorActivationCheckpointSchema,
  orchestratorActivationFinishSchema,
  orchestratorContinuityWriteSchema,
  stageAdvanceSchema,
  workflowCompleteSchema,
  workspaceMemoryDeleteQuerySchema,
  workspaceMemoryWriteSchema,
} from './schemas.js';

export function registerOrchestratorControlWorkflowRoutes(
  context: OrchestratorControlRouteContext,
): void {
  const {
    activationCheckpointService,
    app,
    playbookControlService,
    recoveryHelpers,
    taskScopeService,
    toolResultService,
    workItemContinuityService,
  } = context;

  app.get(
    '/api/v1/orchestrator/tasks/:taskId/workflow/budget',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string };
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      return {
        data: await app.workflowService.getWorkflowBudget(request.auth!.tenantId, taskScope.workflow_id),
      };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/stages/:stageName/request-gate',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; stageName: string };
      const body = parseOrThrow(gateRequestSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'request_gate_approval',
        body.request_id,
        async (client) => {
          try {
            return await playbookControlService.requestStageGateApproval(
              request.auth!,
              taskScope.workflow_id,
              params.stageName,
              body,
              client,
            );
          } catch (error) {
            const advisory = await buildUnconfiguredGateApprovalAdvisory(
              app,
              request.auth!,
              taskScope,
              params.stageName,
              body,
              client,
              error,
            );
            if (advisory) {
              return advisory;
            }
            throw error;
          }
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/stages/:stageName/advance',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; stageName: string };
      const body = parseOrThrow(stageAdvanceSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'advance_stage',
        body.request_id,
        (client) =>
          advanceStageOrNoop(
            request.auth!,
            taskScope,
            params.stageName,
            body,
            client,
            playbookControlService,
          ),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/workflow/complete',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(workflowCompleteSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'complete_workflow',
        body.request_id,
        (client) =>
          completeWorkflowOrNoop(
            request.auth!,
            taskScope,
            body,
            client,
            playbookControlService,
          ),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/workflow/close-with-callouts',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(workflowCompleteSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'close_workflow_with_callouts',
        body.request_id,
        (client) =>
          recoveryHelpers.closeWorkflowWithCallouts(
            request.auth!,
            taskScope.workflow_id,
            body,
            client,
          ),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/memory',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(workspaceMemoryWriteSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      if (!taskScope.workspace_id) {
        throw new ValidationError('This workflow is not linked to a workspace');
      }
      const memoryEntries =
        'updates' in body
          ? Object.entries(body.updates).map(([key, value]) => ({ key, value }))
          : [{ key: body.key, value: body.value }];
      assertWorkspaceMemoryWritesAreDurableKnowledge(memoryEntries);
      if (body.work_item_id) {
        await app.workflowService.getWorkflowWorkItem(
          request.auth!.tenantId,
          taskScope.workflow_id,
          body.work_item_id,
        );
      }
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'memory_write',
        body.request_id,
        (client) =>
          'updates' in body
            ? app.workspaceService.patchWorkspaceMemoryEntries(
                request.auth!,
                taskScope.workspace_id as string,
                Object.entries(body.updates).map(([key, value]) => ({
                  key,
                  value,
                  context: {
                    workflow_id: taskScope.workflow_id,
                    work_item_id: body.work_item_id ?? taskScope.work_item_id,
                    task_id: taskScope.id,
                    stage_name: taskScope.stage_name,
                  },
                })),
                client,
              )
            : app.workspaceService.patchWorkspaceMemory(
                request.auth!,
                taskScope.workspace_id as string,
                {
                  ...body,
                  context: {
                    workflow_id: taskScope.workflow_id,
                    work_item_id: body.work_item_id ?? taskScope.work_item_id,
                    task_id: taskScope.id,
                    stage_name: taskScope.stage_name,
                  },
                },
                client,
              ),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/activation-checkpoint',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(orchestratorActivationCheckpointSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'activation_checkpoint_write',
        body.request_id,
        (client) =>
          activationCheckpointService
            .persistCheckpoint(
              request.auth!.tenantId,
              taskScope.id,
              {
                ...body.activation_checkpoint,
                activation_id: body.activation_checkpoint.activation_id ?? taskScope.activation_id,
              },
              client,
            )
            .then((checkpoint) => ({
              last_activation_checkpoint: checkpoint,
            })),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/activation-finish',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(orchestratorActivationFinishSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'activation_finish',
        body.request_id,
        (client) =>
          activationCheckpointService
            .persistDerivedCheckpoint(
              request.auth!.tenantId,
              {
                task_id: taskScope.id,
                workflow_id: taskScope.workflow_id,
                work_item_id: taskScope.work_item_id,
                activation_id: taskScope.activation_id,
              },
              client,
            )
            .then((checkpoint) => ({
              last_activation_checkpoint: checkpoint,
            })),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/continuity',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(orchestratorContinuityWriteSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const workItemId = await resolveContinuityWorkItemId(
        app,
        request.auth!.tenantId,
        taskScope,
        body,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'continuity_write',
        body.request_id,
        (client) =>
          workItemContinuityService.persistOrchestratorFinishState(
            request.auth!.tenantId,
            {
              ...taskScope,
              work_item_id: workItemId,
              role: 'orchestrator',
            },
            body,
            client,
          ) as Promise<Record<string, unknown>>,
      );
      return { data: stored };
    },
  );

  app.delete(
    '/api/v1/orchestrator/tasks/:taskId/memory/:key',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; key: string };
      const query = parseOrThrow(workspaceMemoryDeleteQuerySchema.safeParse(request.query));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      if (!taskScope.workspace_id) {
        throw new ValidationError('This workflow is not linked to a workspace');
      }
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'memory_delete',
        query.request_id,
        (client) =>
          app.workspaceService.removeWorkspaceMemory(
            request.auth!,
            taskScope.workspace_id as string,
            params.key,
            client,
            {
              workflow_id: taskScope.workflow_id,
              work_item_id: taskScope.work_item_id,
              task_id: taskScope.id,
              stage_name: taskScope.stage_name,
            },
          ),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/workflows',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(childWorkflowCreateSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );

      let workflow: Record<string, unknown>;
      let statusCode = 201;
      const existing = body.request_id
        ? await loadExistingChildWorkflow(
            app,
            request.auth!,
            taskScope.workflow_id,
            body.request_id,
          )
        : null;
      if (existing) {
        workflow = existing;
        statusCode = 200;
      } else {
        try {
          workflow = await app.workflowService.createWorkflow(request.auth!, {
            playbook_id: body.playbook_id,
            workspace_id: taskScope.workspace_id ?? undefined,
            name: body.name,
            parameters: body.parameters,
            metadata: {
              ...(body.metadata ?? {}),
              parent_workflow_id: taskScope.workflow_id,
              parent_orchestrator_task_id: taskScope.id,
              parent_context: body.parent_context ?? null,
              create_request_id: body.request_id,
            },
            config_overrides: body.config_overrides,
            instruction_config: body.instruction_config,
          });
        } catch (error) {
          if (!body.request_id || !isWorkflowCreateRequestConflict(error)) {
            throw error;
          }
          const conflicted = await loadExistingChildWorkflow(
            app,
            request.auth!,
            taskScope.workflow_id,
            body.request_id,
          );
          if (!conflicted) {
            throw error;
          }
          workflow = conflicted;
          statusCode = 200;
        }
      }

      await normalizeOrchestratorChildWorkflowLinkage(
        app.pgPool,
        request.auth!.tenantId,
        {
          parentWorkflowId: taskScope.workflow_id,
          parentOrchestratorTaskId: taskScope.id,
          parentOrchestratorActivationId: taskScope.activation_id,
          parentWorkItemId: taskScope.work_item_id,
          parentStageName: taskScope.stage_name,
          parentContext: body.parent_context,
        },
        String(workflow.id),
      );

      return reply.status(statusCode).send({ data: workflow });
    },
  );
}
