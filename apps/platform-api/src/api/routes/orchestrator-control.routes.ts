import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiKeyIdentity } from '../../auth/api-key.js';
import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { WorkflowActivationDispatchService } from '../../services/workflow-activation-dispatch-service.js';
import { WorkflowActivationService } from '../../services/workflow-activation-service.js';
import { WorkflowStateService } from '../../services/workflow-state-service.js';
import { PlaybookWorkflowControlService } from '../../services/playbook-workflow-control-service.js';
import { OrchestratorTaskMessageService } from '../../services/orchestrator-task-message-service.js';
import { assertProjectMemoryWritesAreDurableKnowledge } from '../../services/project-memory-write-guard.js';
import { TaskAgentScopeService } from '../../services/task-agent-scope-service.js';
import { HandoffService } from '../../services/handoff-service.js';
import { SchemaValidationFailedError, ValidationError } from '../../errors/domain-errors.js';
import { WorkflowToolResultService } from '../../services/workflow-tool-result-service.js';

const orchestratorTaskTypeSchema = z.enum(['analysis', 'code', 'review', 'test', 'docs', 'custom']);
const credentialRefsSchema = z.record(z.string().min(1).max(255)).refine(
  (record) => Object.values(record).every((value) => value.trim().startsWith('secret:')),
  { message: 'credentials must use secret: references' },
);

const workItemCreateSchema = z.object({
  request_id: z.string().min(1).max(255),
  parent_work_item_id: z.string().uuid().optional(),
  stage_name: z.string().min(1).max(120),
  title: z.string().min(1).max(500),
  goal: z.string().min(1).max(4000),
  acceptance_criteria: z.string().min(1).max(4000),
  column_id: z.string().min(1).max(120).optional(),
  owner_role: z.string().max(120).optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  notes: z.string().max(4000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const workItemUpdateSchema = z.object({
  request_id: z.string().min(1).max(255),
  parent_work_item_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(500).optional(),
  goal: z.string().max(4000).optional(),
  acceptance_criteria: z.string().max(4000).optional(),
  stage_name: z.string().min(1).max(120).optional(),
  column_id: z.string().min(1).max(120).optional(),
  owner_role: z.string().max(120).nullable().optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  notes: z.string().max(4000).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const orchestratorTaskCreateSchema = z.object({
  request_id: z.string().min(1).max(255),
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(5000),
  work_item_id: z.string().uuid(),
  stage_name: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  type: orchestratorTaskTypeSchema.optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  input: z.record(z.unknown()).optional(),
  context: z.record(z.unknown()).optional(),
  depends_on: z.array(z.string().uuid()).optional(),
  credentials: credentialRefsSchema.optional(),
  requires_approval: z.boolean().optional(),
  requires_output_review: z.boolean().optional(),
  review_prompt: z.string().max(2000).optional(),
  capabilities_required: z.array(z.string().min(1)).max(20).optional(),
  role_config: z.record(z.unknown()).optional(),
  environment: z.record(z.unknown()).optional(),
  resource_bindings: z.array(z.unknown()).optional(),
  timeout_minutes: z.number().int().min(1).max(240).optional(),
  token_budget: z.number().int().positive().optional(),
  cost_cap_usd: z.number().positive().optional(),
  auto_retry: z.boolean().optional(),
  max_retries: z.number().int().min(0).max(10).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const orchestratorTaskInputUpdateSchema = z.object({
  request_id: z.string().min(1).max(255),
  input: z.record(z.unknown()),
});

const orchestratorTaskMutationSchema = z.object({
  request_id: z.string().min(1).max(255),
});

const orchestratorTaskRetrySchema = orchestratorTaskMutationSchema.extend({
  override_input: z.record(z.unknown()).optional(),
  force: z.boolean().optional(),
});

const orchestratorTaskReworkSchema = orchestratorTaskMutationSchema.extend({
  feedback: z.string().min(1).max(4000),
  override_input: z.record(z.unknown()).optional(),
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
});

const orchestratorTaskReassignSchema = orchestratorTaskMutationSchema.extend({
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
  reason: z.string().min(1).max(4000),
});

const orchestratorTaskEscalateSchema = orchestratorTaskMutationSchema.extend({
  reason: z.string().min(1).max(4000),
  context: z.record(z.unknown()).optional(),
  recommendation: z.string().max(4000).optional(),
  blocking_task_id: z.string().uuid().optional(),
  urgency: z.enum(['info', 'important', 'critical']).optional(),
});

const orchestratorTaskMessageSchema = orchestratorTaskMutationSchema.extend({
  message: z.string().min(1).max(4000),
  urgency: z.enum(['info', 'important', 'critical']).optional(),
});

const gateRequestSchema = z.object({
  request_id: z.string().min(1).max(255),
  summary: z.string().min(1).max(4000),
  recommendation: z.string().max(4000).optional(),
  key_artifacts: z.array(z.record(z.unknown())).max(50).optional(),
  concerns: z.array(z.string().min(1).max(4000)).max(50).optional(),
});

const stageAdvanceSchema = z.object({
  request_id: z.string().min(1).max(255),
  to_stage_name: z.string().min(1).max(120).optional(),
  summary: z.string().max(4000).optional(),
});

const workflowCompleteSchema = z.object({
  request_id: z.string().min(1).max(255),
  summary: z.string().min(1).max(4000),
  final_artifacts: z.array(z.string().min(1).max(2000)).max(100).optional(),
});

const projectMemoryUpdatesSchema = z
  .record(z.string().min(1).max(256), z.unknown())
  .refine((value) => Object.keys(value).length > 0, {
    message: 'updates must contain at least one entry',
  });

const projectMemoryWriteSchema = z.union([
  z.object({
    request_id: z.string().min(1).max(255),
    key: z.string().min(1).max(256),
    value: z.unknown(),
    work_item_id: z.string().uuid().optional(),
  }),
  z.object({
    request_id: z.string().min(1).max(255),
    updates: projectMemoryUpdatesSchema,
    work_item_id: z.string().uuid().optional(),
  }),
]);

const childWorkflowCreateSchema = z.object({
  request_id: z.string().min(1).max(255),
  playbook_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  parent_context: z.string().max(8000).optional(),
  parameters: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  config_overrides: z.record(z.unknown()).optional(),
  instruction_config: z.record(z.unknown()).optional(),
});

const workItemIdParamSchema = z.string().uuid();

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

function parseWorkItemIdOrThrow(value: string): string {
  const parsed = workItemIdParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('work_item_id must be a valid uuid');
  }
  return parsed.data;
}

const projectMemoryDeleteQuerySchema = z.object({
  request_id: z.string().min(1).max(255),
});

export const orchestratorControlRoutes: FastifyPluginAsync = async (app) => {
  const toolResultService = new WorkflowToolResultService(app.pgPool);
  const taskScopeService = new TaskAgentScopeService(app.pgPool);
  const taskMessageService = new OrchestratorTaskMessageService(
    app.pgPool,
    app.eventService,
    app.workerConnectionHub,
    { staleAfterMs: app.config.ORCHESTRATOR_TASK_MESSAGE_DELIVERY_STALE_AFTER_MS },
  );
  const handoffService = new HandoffService(app.pgPool);
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

  const withManagedSpecialistTask = async (
    identity: ApiKeyIdentity,
    orchestratorTaskId: string,
    managedTaskId: string,
  ) => {
    const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
      identity,
      orchestratorTaskId,
    );
    await loadManagedSpecialistTask(app, identity, taskScope.workflow_id, managedTaskId);
    return taskScope;
  };

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
      const workItem = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'create_work_item',
        body.request_id,
        (client) =>
          app.workflowService.createWorkflowWorkItem(
            request.auth!,
            taskScope.workflow_id,
            body,
            client,
          ),
      );
      return reply.status(201).send({ data: workItem });
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
          current_checkpoint: workItem.current_checkpoint ?? workItem.stage_name ?? null,
          column_id: workItem.column_id ?? null,
          owner_role: workItem.owner_role ?? null,
          next_expected_actor: workItem.next_expected_actor ?? null,
          next_expected_action: workItem.next_expected_action ?? null,
          rework_count: workItem.rework_count ?? 0,
          latest_handoff_completion: workItem.latest_handoff_completion ?? null,
          unresolved_findings: workItem.unresolved_findings ?? [],
          review_focus: workItem.review_focus ?? [],
          known_risks: workItem.known_risks ?? [],
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

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/approve',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskMutationSchema.safeParse(request.body));
      const taskScope = await withManagedSpecialistTask(
        request.auth!,
        params.taskId,
        params.managedTaskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'approve_task',
        body.request_id,
        (client) => app.taskService.approveTask(request.auth!, params.managedTaskId, client),
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
      const taskScope = await withManagedSpecialistTask(
        request.auth!,
        params.taskId,
        params.managedTaskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'approve_task_output',
        body.request_id,
        (client) => app.taskService.approveTaskOutput(request.auth!, params.managedTaskId, client),
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
      const taskScope = await withManagedSpecialistTask(
        request.auth!,
        params.taskId,
        params.managedTaskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'request_rework',
        body.request_id,
        (client) => app.taskService.requestTaskChanges(request.auth!, params.managedTaskId, body, client),
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
      const taskScope = await withManagedSpecialistTask(
        request.auth!,
        params.taskId,
        params.managedTaskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'retry_task',
        body.request_id,
        (client) => app.taskService.retryTask(request.auth!, params.managedTaskId, body, client),
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
      const taskScope = await withManagedSpecialistTask(
        request.auth!,
        params.taskId,
        params.managedTaskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'cancel_task',
        body.request_id,
        (client) => app.taskService.cancelTask(request.auth!, params.managedTaskId, client),
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
      const taskScope = await withManagedSpecialistTask(
        request.auth!,
        params.taskId,
        params.managedTaskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'reassign_task',
        body.request_id,
        (client) => app.taskService.reassignTask(request.auth!, params.managedTaskId, body, client),
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
      const taskScope = await withManagedSpecialistTask(
        request.auth!,
        params.taskId,
        params.managedTaskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'escalate_to_human',
        body.request_id,
        (client) =>
          app.taskService.escalateTask(
            request.auth!,
            params.managedTaskId,
            {
              reason: body.reason,
              context: body.context,
              recommendation: body.recommendation,
              blocking_task_id: body.blocking_task_id,
              urgency: body.urgency,
              escalation_target: 'human',
            },
            client,
          ),
      );
      return { data: stored };
    },
  );

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
      const task = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'create_task',
        body.request_id,
        (client) =>
          app.taskService.createTask(
            request.auth!,
            {
              ...body,
              workflow_id: taskScope.workflow_id,
              project_id: taskScope.project_id ?? undefined,
              activation_id: taskScope.activation_id ?? undefined,
              is_orchestrator_task: false,
              capabilities_required: body.capabilities_required ?? [body.role],
              metadata: {
                ...(body.metadata ?? {}),
                created_by_orchestrator_task_id: taskScope.id,
                orchestrator_activation_id: taskScope.activation_id,
              },
            },
            client,
          ),
      );
      return reply.status(201).send({ data: task });
    },
  );

  app.patch(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/input',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskInputUpdateSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      await loadManagedSpecialistTask(
        app,
        request.auth!,
        taskScope.workflow_id,
        params.managedTaskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'update_task_input',
        body.request_id,
        (client) => app.taskService.updateTaskInput(request.auth!.tenantId, params.managedTaskId, body.input, client),
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
      const finalResponse = await toolResultService.replaceResult(
        request.auth!.tenantId,
        taskScope.workflow_id,
        'send_task_message',
        body.request_id,
        delivered,
      );
      return { data: finalResponse };
    },
  );

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
        (client) =>
          playbookControlService.requestStageGateApproval(
            request.auth!,
            taskScope.workflow_id,
            params.stageName,
            body,
            client,
          ),
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
          playbookControlService.advanceStage(
            request.auth!,
            taskScope.workflow_id,
            params.stageName,
            body,
            client,
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
          playbookControlService.completeWorkflow(
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
      const body = parseOrThrow(projectMemoryWriteSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      if (!taskScope.project_id) {
        throw new ValidationError('This workflow is not linked to a project');
      }
      const memoryEntries =
        'updates' in body
          ? Object.entries(body.updates).map(([key, value]) => ({ key, value }))
          : [{ key: body.key, value: body.value }];
      assertProjectMemoryWritesAreDurableKnowledge(memoryEntries);
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
            ? app.projectService.patchProjectMemoryEntries(
                request.auth!,
                taskScope.project_id as string,
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
            : app.projectService.patchProjectMemory(
                request.auth!,
                taskScope.project_id as string,
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

  app.delete(
    '/api/v1/orchestrator/tasks/:taskId/memory/:key',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; key: string };
      const query = parseOrThrow(projectMemoryDeleteQuerySchema.safeParse(request.query));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      if (!taskScope.project_id) {
        throw new ValidationError('This workflow is not linked to a project');
      }
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'memory_delete',
        query.request_id,
        (client) =>
          app.projectService.removeProjectMemory(
            request.auth!,
            taskScope.project_id as string,
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
            project_id: taskScope.project_id ?? undefined,
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
};

async function runIdempotentMutation<T extends Record<string, unknown>>(
  app: FastifyInstance,
  toolResultService: WorkflowToolResultService,
  tenantId: string,
  workflowId: string,
  toolName: string,
  requestId: string | undefined,
  run: (client: import('../../db/database.js').DatabaseClient) => Promise<T>,
): Promise<T> {
  const normalizedRequestId = requestId?.trim();
  if (!normalizedRequestId) {
    const client = await app.pgPool.connect();
    try {
      await client.query('BEGIN');
      const response = await run(client);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const client = await app.pgPool.connect();
  try {
    await client.query('BEGIN');
    await toolResultService.lockRequest(
      tenantId,
      workflowId,
      toolName,
      normalizedRequestId,
      client,
    );
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
    const response = await run(client);
    const stored = await toolResultService.storeResult(
      tenantId,
      workflowId,
      toolName,
      normalizedRequestId,
      response,
      client,
    );
    await client.query('COMMIT');
    return stored as T;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function loadExistingChildWorkflow(
  app: FastifyInstance,
  identity: ApiKeyIdentity,
  parentWorkflowId: string,
  requestId: string,
) {
  const result = await app.pgPool.query<{ id: string }>(
    `SELECT id
       FROM workflows
      WHERE tenant_id = $1
        AND metadata->>'parent_workflow_id' = $2
        AND metadata->>'create_request_id' = $3
      LIMIT 1`,
    [identity.tenantId, parentWorkflowId, requestId],
  );
  const workflowId = result.rows[0]?.id;
  if (!workflowId) {
    return null;
  }
  return app.workflowService.getWorkflow(identity.tenantId, workflowId);
}

function isWorkflowCreateRequestConflict(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === '23505' && pgError.constraint === 'idx_workflows_parent_create_request';
}

async function loadManagedSpecialistTask(
  app: FastifyInstance,
  identity: ApiKeyIdentity,
  workflowId: string,
  taskId: string,
) {
  const task = await app.taskService.getTask(identity.tenantId, taskId) as Record<string, unknown>;
  if (task.workflow_id !== workflowId) {
    throw new ValidationError('Managed task must belong to the orchestrator workflow');
  }
  if (task.is_orchestrator_task) {
    throw new ValidationError('Managed task must be a specialist task');
  }
  return task;
}

interface ChildWorkflowLinkage {
  parentWorkflowId: string;
  parentOrchestratorTaskId: string;
  parentOrchestratorActivationId: string | null;
  parentWorkItemId: string | null;
  parentStageName: string | null;
  parentContext?: string;
}

export async function normalizeOrchestratorChildWorkflowLinkage(
  pool: FastifyInstance['pgPool'],
  tenantId: string,
  linkage: ChildWorkflowLinkage,
  childWorkflowId: string,
): Promise<void> {
  const [parentResult, childResult] = await Promise.all([
    pool.query<{ metadata: Record<string, unknown> | null }>(
      'SELECT metadata FROM workflows WHERE tenant_id = $1 AND id = $2',
      [tenantId, linkage.parentWorkflowId],
    ),
    pool.query<{ metadata: Record<string, unknown> | null }>(
      'SELECT metadata FROM workflows WHERE tenant_id = $1 AND id = $2',
      [tenantId, childWorkflowId],
    ),
  ]);
  if (!parentResult.rowCount || !childResult.rowCount) {
    return;
  }

  const parentMetadata = asRecord(parentResult.rows[0].metadata);
  const childMetadata = asRecord(childResult.rows[0].metadata);
  const childWorkflowIds = dedupeStrings([
    ...readStringArray(parentMetadata.child_workflow_ids),
    childWorkflowId,
  ]);

  await Promise.all([
    pool.query(
      `UPDATE workflows
          SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        tenantId,
        linkage.parentWorkflowId,
        {
          child_workflow_ids: childWorkflowIds,
          latest_child_workflow_id: childWorkflowId,
          latest_child_workflow_created_by_orchestrator_task_id: linkage.parentOrchestratorTaskId,
        },
      ],
    ),
    pool.query(
      `UPDATE workflows
          SET metadata = $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        tenantId,
        childWorkflowId,
        {
          ...childMetadata,
          parent_workflow_id: linkage.parentWorkflowId,
          parent_orchestrator_task_id: linkage.parentOrchestratorTaskId,
          parent_orchestrator_activation_id: linkage.parentOrchestratorActivationId,
          parent_work_item_id: linkage.parentWorkItemId,
          parent_stage_name: linkage.parentStageName,
          parent_context: linkage.parentContext ?? childMetadata.parent_context ?? null,
          parent_link_kind: 'orchestrator_child',
        },
      ],
    ),
  ]);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
