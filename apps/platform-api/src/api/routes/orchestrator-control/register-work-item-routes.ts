import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';

import {
  buildRecoverableCompleteWorkItemNoopIfNotReady,
  createWorkflowWorkItemOrNoop,
} from './recoverable-mutations.js';
import type { OrchestratorControlRouteContext } from './route-context.js';
import {
  isRecoverableNotAppliedResult,
  parseOrThrow,
  parseWorkItemIdOrThrow,
  runIdempotentMutation,
} from './shared.js';
import {
  reopenWorkItemForMissingHandoffSchema,
  waivePreferredStepSchema,
  workItemCompleteSchema,
  workItemCreateSchema,
  workItemUpdateSchema,
} from './schemas.js';
import { normalizeOrchestratorWorkItemCreateInput } from './task-normalization.js';

export function registerOrchestratorControlWorkItemRoutes(
  context: OrchestratorControlRouteContext,
): void {
  const {
    app,
    handoffService,
    playbookControlService,
    recoveryHelpers,
    taskScopeService,
    toolResultService,
  } = context;

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/work-items',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(workItemCreateSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const normalizedBody = await normalizeOrchestratorWorkItemCreateInput(
        app.pgPool,
        request.auth!.tenantId,
        taskScope,
        body,
      );
      const workItem = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'create_work_item',
        body.request_id,
        (client) =>
          createWorkflowWorkItemOrNoop(
            app,
            request.auth!,
            taskScope,
            taskScope.workflow_id,
            normalizedBody,
            client,
          ),
      );
      return reply.status(isRecoverableNotAppliedResult(workItem) ? 200 : 201).send({ data: workItem });
    },
  );

  app.patch(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const body = parseOrThrow(workItemUpdateSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'update_work_item',
        body.request_id,
        (client) =>
          playbookControlService.updateWorkItem(
            request.auth!,
            taskScope.workflow_id,
            params.workItemId,
            body,
            client,
          ),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId/complete',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const body = parseOrThrow(workItemCompleteSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'complete_work_item',
        body.request_id,
        async (client) => {
          try {
            return await playbookControlService.completeWorkItem(
              request.auth!,
              taskScope.workflow_id,
              params.workItemId,
              {
                ...body,
                acting_task_id: taskScope.id,
              },
              client,
            );
          } catch (error) {
            const recoverableResult = buildRecoverableCompleteWorkItemNoopIfNotReady({
              error,
              taskScope,
              workItemId: params.workItemId,
            });
            if (recoverableResult) {
              return recoverableResult;
            }
            throw error;
          }
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId/close-with-callouts',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const body = parseOrThrow(workItemCompleteSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'close_work_item_with_callouts',
        body.request_id,
        async (client) => {
          try {
            return await recoveryHelpers.closeWorkItemWithCallouts(
              request.auth!,
              taskScope.workflow_id,
              params.workItemId,
              {
                ...body,
                acting_task_id: taskScope.id,
              },
              client,
            );
          } catch (error) {
            const recoverableResult = buildRecoverableCompleteWorkItemNoopIfNotReady({
              error,
              taskScope,
              workItemId: params.workItemId,
            });
            if (recoverableResult) {
              return recoverableResult;
            }
            throw error;
          }
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId/reopen-for-missing-handoff',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const body = parseOrThrow(reopenWorkItemForMissingHandoffSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'reopen_work_item_for_missing_handoff',
        body.request_id,
        (client) =>
          recoveryHelpers.reopenWorkItemForMissingHandoff(
            request.auth!,
            taskScope.workflow_id,
            params.workItemId,
            { reason: body.reason },
            client,
          ),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId/waive-preferred-step',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const body = parseOrThrow(waivePreferredStepSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'waive_preferred_step',
        body.request_id,
        (client) =>
          recoveryHelpers.waivePreferredStep(
            request.auth!,
            taskScope.workflow_id,
            params.workItemId,
            {
              code: body.code,
              reason: body.reason,
              summary: body.summary,
              role: body.role,
            },
            client,
          ),
      );
      return { data: stored };
    },
  );

  app.get(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId/continuity',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const workItemId = parseWorkItemIdOrThrow(params.workItemId);
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const workItem = await app.workflowService.getWorkflowWorkItem(
        request.auth!.tenantId,
        taskScope.workflow_id,
        workItemId,
      );
      return {
        data: {
          id: workItem.id,
          stage_name: workItem.stage_name ?? null,
          column_id: workItem.column_id ?? null,
          owner_role: workItem.owner_role ?? null,
          next_expected_actor: workItem.next_expected_actor ?? null,
          next_expected_action: workItem.next_expected_action ?? null,
          rework_count: workItem.rework_count ?? 0,
          escalation_status: workItem.escalation_status ?? null,
          latest_handoff_completion: workItem.latest_handoff_completion ?? null,
          latest_handoff_resolution: workItem.latest_handoff_resolution ?? null,
          unresolved_findings: workItem.unresolved_findings ?? [],
          focus_areas: workItem.focus_areas ?? [],
          known_risks: workItem.known_risks ?? [],
          gate_status: workItem.gate_status ?? null,
          gate_decision_feedback: workItem.gate_decision_feedback ?? null,
          gate_decided_at: workItem.gate_decided_at ?? null,
          completed_at: workItem.completed_at ?? null,
        },
      };
    },
  );

  app.get(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId/handoffs',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const workItemId = parseWorkItemIdOrThrow(params.workItemId);
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      await app.workflowService.getWorkflowWorkItem(
        request.auth!.tenantId,
        taskScope.workflow_id,
        workItemId,
      );
      const data = await handoffService.listWorkItemHandoffs(
        request.auth!.tenantId,
        taskScope.workflow_id,
        workItemId,
      );
      return { data };
    },
  );

  app.get(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId/handoffs/latest',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const workItemId = parseWorkItemIdOrThrow(params.workItemId);
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      await app.workflowService.getWorkflowWorkItem(
        request.auth!.tenantId,
        taskScope.workflow_id,
        workItemId,
      );
      const data = await handoffService.getLatestWorkItemHandoff(
        request.auth!.tenantId,
        taskScope.workflow_id,
        workItemId,
      );
      return { data };
    },
  );
}
