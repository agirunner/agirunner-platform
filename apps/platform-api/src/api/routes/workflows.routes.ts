import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withAllowedScopes, withScope } from '../../auth/fastify-auth-hook.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../pagination.js';
import {
  ConflictError,
  SchemaValidationFailedError,
  ValidationError,
} from '../../errors/domain-errors.js';
import {
  createWorkflowDocument,
  deleteWorkflowDocument,
  listWorkflowDocuments,
  updateWorkflowDocument,
} from '../../services/document-reference-service.js';
import { ApprovalQueueService } from '../../services/approval-queue-service.js';
import {
  EventQueryService,
  parseCursorAfter,
  parseCursorLimit,
} from '../../services/event-query-service.js';
import { HandoffService } from '../../services/handoff-service.js';
import { WorkflowChainingService } from '../../services/workflow-chaining-service.js';
import { PlaybookWorkflowControlService } from '../../services/playbook-workflow-control-service.js';
import { WorkflowActivationDispatchService } from '../../services/workflow-activation-dispatch-service.js';
import { WorkflowActivationService } from '../../services/workflow-activation-service.js';
import { WorkflowStateService } from '../../services/workflow-state-service.js';
import { WorkflowToolResultService } from '../../services/workflow-tool-result-service.js';
import { runIdempotentWorkflowBackedTaskAction } from './task-route-idempotency.js';
import { workflowOperatorRecordRoutes } from './workflow-operator-record-routes.js';

const roleModelOverrideSchema = z.object({
  provider: z.string().min(1).max(120),
  model: z.string().min(1).max(200),
  reasoning_config: z.record(z.unknown()).nullable().optional(),
});

const modelOverridesSchema = z.record(z.string().min(1).max(120), roleModelOverrideSchema);

const workflowBudgetSchema = z.object({
  token_budget: z.number().int().positive().optional(),
  cost_cap_usd: z.number().positive().optional(),
  max_duration_minutes: z.number().int().positive().optional(),
});

const workflowCreateSchema = z.object({
  playbook_id: z.string().uuid(),
  workspace_id: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  parameters: z.record(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  config_overrides: z.record(z.unknown()).optional(),
  instruction_config: z.record(z.unknown()).optional(),
  budget: workflowBudgetSchema.optional(),
  model_overrides: modelOverridesSchema.optional(),
  live_visibility_mode: z.enum(['standard', 'enhanced']).optional(),
});

const workflowSettingsPatchSchema = z.object({
  live_visibility_mode: z.enum(['standard', 'enhanced']).nullable(),
  settings_revision: z.number().int().min(0),
});

const requestIdSchema = z.string().min(1).max(255);

const stageGateSchema = z.object({
  request_id: requestIdSchema,
  action: z.enum(['approve', 'reject', 'request_changes', 'block']),
  feedback: z.string().min(1).max(4000).optional(),
});

const workflowChainSchema = z.object({
  request_id: requestIdSchema,
  playbook_id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  parameters: z.record(z.string()).optional(),
});

const workflowControlMutationSchema = z.object({
  request_id: requestIdSchema,
});

const workflowWorkItemTaskMutationSchema = z.object({
  request_id: requestIdSchema.optional(),
});

const workflowWorkItemTaskRejectSchema = workflowWorkItemTaskMutationSchema.extend({
  feedback: z.string().min(1).max(4000),
});

const workflowWorkItemTaskRequestChangesSchema = workflowWorkItemTaskRejectSchema.extend({
  override_input: z.record(z.unknown()).optional(),
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
});

const workflowWorkItemTaskRetrySchema = workflowWorkItemTaskMutationSchema.extend({
  override_input: z.record(z.unknown()).optional(),
  force: z.boolean().optional(),
});

const workflowWorkItemTaskSkipSchema = workflowWorkItemTaskMutationSchema.extend({
  reason: z.string().min(1).max(4000),
});

const workflowWorkItemTaskReassignSchema = workflowWorkItemTaskSkipSchema.extend({
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
});

const workflowWorkItemTaskResolveEscalationSchema = workflowWorkItemTaskMutationSchema.extend({
  instructions: z.string().min(1).max(4000),
  context: z.record(z.unknown()).optional(),
});

const workflowWorkItemTaskAgentEscalateSchema = workflowWorkItemTaskMutationSchema.extend({
  reason: z.string().min(1).max(4000),
  context_summary: z.string().max(4000).optional(),
  work_so_far: z.string().max(8000).optional(),
});

const workflowWorkItemTaskOutputOverrideSchema = workflowWorkItemTaskMutationSchema.extend({
  output: z.unknown(),
  reason: z.string().min(1).max(4000),
});

const workItemCreateSchema = z.object({
  request_id: requestIdSchema,
  parent_work_item_id: z.string().uuid().optional(),
  branch_key: z.string().min(1).max(120).optional(),
  stage_name: z.string().min(1).max(120).optional(),
  title: z.string().min(1).max(500),
  goal: z.string().max(4000).optional(),
  acceptance_criteria: z.string().max(4000).optional(),
  column_id: z.string().min(1).max(120).optional(),
  owner_role: z.string().max(120).optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  notes: z.string().max(4000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const workItemUpdateSchema = z.object({
  request_id: requestIdSchema,
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

const workItemResolveEscalationSchema = z.object({
  request_id: requestIdSchema,
  action: z.enum(['dismiss', 'unblock_subject', 'reopen_subject']),
  feedback: z.string().min(1).max(4000).optional(),
});

const workflowDocumentCreateSchema = z.object({
  request_id: requestIdSchema,
  logical_name: z.string().min(1).max(255),
  source: z.enum(['repository', 'artifact', 'external']),
  title: z.string().max(4000).optional(),
  description: z.string().max(8000).optional(),
  metadata: z.record(z.unknown()).optional(),
  repository: z.string().min(1).max(255).optional(),
  path: z.string().min(1).max(4000).optional(),
  url: z.string().url().optional(),
  task_id: z.string().uuid().optional(),
  artifact_id: z.string().uuid().optional(),
  logical_path: z.string().min(1).max(4000).optional(),
});

const workflowDocumentUpdateSchema = z
  .object({
    request_id: requestIdSchema,
    source: z.enum(['repository', 'artifact', 'external']).optional(),
    title: z.string().max(4000).nullable().optional(),
    description: z.string().max(8000).nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
    repository: z.string().min(1).max(255).nullable().optional(),
    path: z.string().min(1).max(4000).nullable().optional(),
    url: z.string().url().nullable().optional(),
    task_id: z.string().uuid().nullable().optional(),
    artifact_id: z.string().uuid().nullable().optional(),
    logical_path: z.string().min(1).max(4000).nullable().optional(),
  })
  .refine(hasWorkflowDocumentUpdateFields, {
    message: 'At least one field is required',
  });

const workflowDocumentDeleteQuerySchema = z.object({
  request_id: requestIdSchema,
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

function parseCsv(raw?: string): string[] | undefined {
  return raw
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function assertTaskBelongsToWorkflowWorkItem(
  app: FastifyInstance,
  tenantId: string,
  workflowId: string,
  workItemId: string,
  taskId: string,
) {
  const task = (await app.taskService.getTask(tenantId, taskId)) as Record<string, unknown>;
  if (task.workflow_id !== workflowId || task.work_item_id !== workItemId) {
    throw new ValidationError('Task must belong to the selected workflow work item');
  }
}

async function assertTaskBelongsToWorkflowTask(
  app: FastifyInstance,
  tenantId: string,
  workflowId: string,
  taskId: string,
) {
  const task = (await app.taskService.getTask(tenantId, taskId)) as Record<string, unknown>;
  if (task.workflow_id !== workflowId) {
    throw new ValidationError('Task must belong to the selected workflow');
  }
  if (typeof task.work_item_id === 'string' && task.work_item_id.trim().length > 0) {
    throw new ValidationError(
      'Tasks attached to workflow work items must use the grouped work-item operator flow.',
    );
  }
}

function selectWorkflowWorkItemRecoveryTask(tasks: Record<string, unknown>[]) {
  return (
    tasks.find((task) => readTaskState(task.state) === 'failed') ??
    tasks.find((task) => readTaskState(task.state) === 'escalated') ??
    null
  );
}

function readTaskState(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

export const workflowRoutes: FastifyPluginAsync = async (app) => {
  const workflowService = app.workflowService;
  const workflowChainingService = new WorkflowChainingService(app.pgPool, workflowService);
  const approvalQueueService = new ApprovalQueueService(app.pgPool);
  const eventQueryService = new EventQueryService(app.pgPool);
  const handoffService = new HandoffService(app.pgPool);
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
  });
  const workflowWorkItemTaskMutationPreHandler = [
    authenticateApiKey,
    withAllowedScopes(['admin', 'worker']),
  ];

  await app.register(workflowOperatorRecordRoutes);

  app.post(
    '/api/v1/workflows',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const body = parseOrThrow(workflowCreateSchema.safeParse(request.body));
      const workflow = await workflowService.createWorkflow(request.auth!, {
        ...body,
        metadata: mergeWorkflowMetadata(body.metadata, body.model_overrides),
        live_visibility_mode: body.live_visibility_mode,
      });
      return reply.status(201).send({ data: workflow });
    },
  );

  app.get(
    '/api/v1/workflows/:id/settings',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.workflowSettingsService.getWorkflowSettings(request.auth!.tenantId, params.id),
      };
    },
  );

  app.patch(
    '/api/v1/workflows/:id/settings',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowSettingsPatchSchema.safeParse(request.body ?? {}));
      return {
        data: await app.workflowSettingsService.updateWorkflowSettings(request.auth!, params.id, {
          liveVisibilityMode: body.live_visibility_mode,
          settingsRevision: body.settings_revision,
        }),
      };
    },
  );

  app.get(
    '/api/v1/workflows',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const query = request.query as Record<string, string | undefined>;
      const page = Number(query.page ?? DEFAULT_PAGE);
      const perPage = Number(query.per_page ?? DEFAULT_PER_PAGE);
      if (
        !Number.isFinite(page) ||
        page <= 0 ||
        !Number.isFinite(perPage) ||
        perPage <= 0 ||
        perPage > MAX_PER_PAGE
      ) {
        throw new ValidationError('Invalid pagination values');
      }

      return workflowService.listWorkflows(request.auth!.tenantId, {
        workspace_id: query.workspace_id,
        state: query.state,
        playbook_id: query.playbook_id,
        page,
        per_page: perPage,
      });
    },
  );

  app.get(
    '/api/v1/workflows/:id',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const workflow = await workflowService.getWorkflow(request.auth!.tenantId, params.id);
      return { data: workflow };
    },
  );

  app.get(
    '/api/v1/workflows/:id/budget',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await workflowService.getWorkflowBudget(request.auth!.tenantId, params.id),
      };
    },
  );

  app.get(
    '/api/v1/workflows/:id/board',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await workflowService.getWorkflowBoard(request.auth!.tenantId, params.id) };
    },
  );

  app.get(
    '/api/v1/workflows/:id/stages',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await workflowService.listWorkflowStages(request.auth!.tenantId, params.id) };
    },
  );

  app.get(
    '/api/v1/workflows/:id/events',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as {
        types?: string;
        event_type?: string;
        entity_type?: string;
        entity_id?: string;
        work_item_id?: string;
        stage_name?: string;
        activation_id?: string;
        gate_id?: string;
        after?: string;
        limit?: string;
        per_page?: string;
      };
      return eventQueryService.listEvents({
        tenantId: request.auth!.tenantId,
        workflowScopeId: params.id,
        entityTypes: parseCsv(query.entity_type),
        entityId: query.entity_id,
        workItemId: query.work_item_id,
        stageName: query.stage_name,
        activationId: query.activation_id,
        gateId: query.gate_id,
        eventTypes: parseCsv(query.types ?? query.event_type),
        after: parseCursorAfter(query.after),
        limit: parseCursorLimit(query.limit ?? query.per_page),
      });
    },
  );

  app.get(
    '/api/v1/workflows/:id/gates',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await approvalQueueService.listWorkflowGates(request.auth!.tenantId, params.id),
      };
    },
  );

  app.get(
    '/api/v1/workflows/:id/gates/:gateId',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string; gateId: string };
      return {
        data: await approvalQueueService.getGate(request.auth!.tenantId, params.gateId, params.id),
      };
    },
  );

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
        (client) => workflowService.createWorkflowWorkItem(request.auth!, params.id, body, client),
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

      const force = body.force ?? readTaskState(selectedTask.state) !== 'failed';
      await assertTaskBelongsToWorkflowWorkItem(
        app,
        request.auth!.tenantId,
        params.id,
        params.workItemId,
        selectedTaskId,
      );
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

      await assertTaskBelongsToWorkflowWorkItem(
        app,
        request.auth!.tenantId,
        params.id,
        params.workItemId,
        selectedTaskId,
      );
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
      await assertTaskBelongsToWorkflowTask(
        app,
        request.auth!.tenantId,
        params.id,
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

  app.get(
    '/api/v1/workflows/:id/config/resolved',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as { show_layers?: string };
      const showLayers = query.show_layers === 'true';
      const config = await workflowService.getResolvedConfig(
        request.auth!.tenantId,
        params.id,
        showLayers,
      );
      return { data: config };
    },
  );

  app.get(
    '/api/v1/workflows/:id/model-overrides',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const workflow = await workflowService.getWorkflow(request.auth!.tenantId, params.id);
      return {
        data: {
          workflow_id: params.id,
          model_overrides: readModelOverrides(asRecord(workflow.metadata).model_overrides),
        },
      };
    },
  );

  app.get(
    '/api/v1/workflows/:id/model-overrides/resolved',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as { roles?: string };
      const workflow = await workflowService.getWorkflow(request.auth!.tenantId, params.id);
      const workflowOverrides = readModelOverrides(asRecord(workflow.metadata).model_overrides);
      const workspaceId = typeof workflow.workspace_id === 'string' ? workflow.workspace_id : null;
      const workspaceOverrides = {};
      const roles = parseRoleQuery(query.roles, workflowOverrides);
      return {
        data: {
          workflow_id: params.id,
          workspace_id: workspaceId,
          workspace_model_overrides: workspaceOverrides,
          workflow_model_overrides: workflowOverrides,
          effective_models: await resolveEffectiveModels(
            app.modelCatalogService,
            request.auth!.tenantId,
            roles,
            workspaceOverrides,
            workflowOverrides,
          ),
        },
      };
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
};

async function runIdempotentTransactionalWorkflowAction<T extends object>(
  app: FastifyInstance,
  toolResultService: WorkflowToolResultService,
  tenantId: string,
  workflowId: string,
  toolName: string,
  requestId: string | undefined,
  run: (client: import('../../db/database.js').DatabaseClient) => Promise<T>,
): Promise<T> {
  const normalizedRequestId = requestId?.trim();
  const client = await app.pgPool.connect();
  try {
    await client.query('BEGIN');
    if (normalizedRequestId) {
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
    }

    const result = await run(client);
    if (normalizedRequestId) {
      const stored = await toolResultService.storeResult(
        tenantId,
        workflowId,
        toolName,
        normalizedRequestId,
        result as Record<string, unknown>,
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

function hasWorkflowDocumentUpdateFields(value: Record<string, unknown>) {
  return Object.keys(value).some((key) => key !== 'request_id');
}

async function runIdempotentWorkflowAction<T extends object>(
  app: FastifyInstance,
  toolResultService: WorkflowToolResultService,
  tenantId: string,
  workflowId: string,
  toolName: string,
  requestId: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const normalizedRequestId = requestId?.trim();
  if (!normalizedRequestId) {
    return run();
  }

  const existing = await loadStoredWorkflowActionResult(
    app,
    toolResultService,
    tenantId,
    workflowId,
    toolName,
    normalizedRequestId,
  );
  if (existing) {
    return existing as T;
  }

  const result = await run();

  const postMutationExisting = await loadStoredWorkflowActionResult(
    app,
    toolResultService,
    tenantId,
    workflowId,
    toolName,
    normalizedRequestId,
  );
  if (postMutationExisting) {
    return postMutationExisting as T;
  }

  return toolResultService.storeResult(
    tenantId,
    workflowId,
    toolName,
    normalizedRequestId,
    result as Record<string, unknown>,
  ) as Promise<T>;
}

async function loadStoredWorkflowActionResult(
  app: FastifyInstance,
  toolResultService: WorkflowToolResultService,
  tenantId: string,
  workflowId: string,
  toolName: string,
  requestId: string,
) {
  const client = await app.pgPool.connect();
  try {
    await client.query('BEGIN');
    await toolResultService.lockRequest(tenantId, workflowId, toolName, requestId, client);
    const existing = await toolResultService.getResult(
      tenantId,
      workflowId,
      toolName,
      requestId,
      client,
    );
    await client.query('COMMIT');
    return existing;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function mergeWorkflowMetadata(
  metadata: Record<string, unknown> | undefined,
  modelOverrides: Record<string, unknown> | undefined,
) {
  if (!modelOverrides) {
    return metadata;
  }
  return {
    ...(metadata ?? {}),
    model_overrides: modelOverrides,
  };
}

function parseRoleQuery(raw: string | undefined, workflowOverrides: Record<string, unknown>) {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return Array.from(new Set([...Object.keys(workflowOverrides)]));
}

function readModelOverrides(value: unknown): Record<string, unknown> {
  const parsed = modelOverridesSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

async function resolveEffectiveModels(
  modelCatalogService: {
    resolveRoleConfig(tenantId: string, roleName: string): Promise<unknown>;
    listProviders(tenantId: string): Promise<unknown[]>;
    listModels(tenantId: string, providerId?: string): Promise<unknown[]>;
    getProviderForOperations(tenantId: string, id: string): Promise<unknown>;
  },
  tenantId: string,
  roles: string[],
  workspaceOverrides: Record<string, unknown>,
  workflowOverrides: Record<string, unknown>,
) {
  const providers = (await modelCatalogService.listProviders(tenantId)) as Array<
    Record<string, unknown>
  >;
  const byId = new Map(providers.map((provider) => [String(provider.id), provider]));
  const byName = new Map(
    providers.flatMap((provider) => {
      const record = provider as Record<string, unknown>;
      const names = [record.name, asRecord(record.metadata).providerType].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
      return names.map((name) => [name, provider] as const);
    }),
  );

  const results: Record<string, unknown> = {};
  for (const role of roles) {
    const baseResolved = (await modelCatalogService.resolveRoleConfig(tenantId, role)) as Record<
      string,
      unknown
    > | null;
    const sanitizedBaseResolved = sanitizeResolvedRoleConfig(baseResolved);
    const workflowOverride = asRecord(workflowOverrides[role]);
    const workspaceOverride = asRecord(workspaceOverrides[role]);
    const activeOverride =
      Object.keys(workflowOverride).length > 0 ? workflowOverride : workspaceOverride;
    const source =
      Object.keys(workflowOverride).length > 0
        ? 'workflow'
        : Object.keys(workspaceOverride).length > 0
          ? 'workspace'
          : 'base';

    if (Object.keys(activeOverride).length === 0) {
      results[role] = {
        source,
        resolved: sanitizedBaseResolved,
        fallback: sanitizedBaseResolved === null,
      };
      continue;
    }

    const providerRef = String(activeOverride.provider);
    const provider = byId.get(providerRef) ?? byName.get(providerRef);
    if (!provider) {
      results[role] = {
        source,
        resolved: sanitizedBaseResolved,
        fallback: true,
        fallback_reason: `provider '${providerRef}' is not available`,
      };
      continue;
    }

    const models = (await modelCatalogService.listModels(tenantId, String(provider.id))) as Array<
      Record<string, unknown>
    >;
    const model = models.find(
      (entry) =>
        String((entry as Record<string, unknown>).model_id) === String(activeOverride.model) &&
        (entry as Record<string, unknown>).is_enabled === true,
    );
    if (!model) {
      results[role] = {
        source,
        resolved: sanitizedBaseResolved,
        fallback: true,
        fallback_reason: `model '${String(activeOverride.model)}' is not enabled for provider '${providerRef}'`,
      };
      continue;
    }

    const providerDetails = (await modelCatalogService.getProviderForOperations(
      tenantId,
      String((provider as Record<string, unknown>).id),
    )) as Record<string, unknown>;
    results[role] = {
      source,
      resolved: {
        provider: {
          name: providerDetails.name,
          providerType: asRecord(providerDetails.metadata).providerType ?? providerDetails.name,
          baseUrl: providerDetails.base_url,
          authMode: providerDetails.auth_mode ?? 'api_key',
          providerId: providerDetails.auth_mode === 'oauth' ? providerDetails.id : null,
        },
        model: {
          modelId: model.model_id,
          contextWindow: model.context_window ?? null,
          endpointType: model.endpoint_type ?? null,
          reasoningConfig: model.reasoning_config ?? null,
        },
        reasoningConfig:
          activeOverride.reasoning_config === undefined
            ? ((baseResolved as Record<string, unknown> | null)?.reasoningConfig ?? null)
            : activeOverride.reasoning_config,
      },
      fallback: false,
    };
  }
  return results;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeResolvedRoleConfig(
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  const provider = asRecord(value.provider);
  return {
    ...value,
    ...(Object.keys(provider).length > 0 ? { provider: sanitizeResolvedProvider(provider) } : {}),
  };
}

function sanitizeResolvedProvider(provider: Record<string, unknown>): Record<string, unknown> {
  const {
    apiKeySecretRef: _apiKeySecretRef,
    api_key_secret_ref: _apiKeySecretRefSnake,
    accessTokenSecret: _accessTokenSecret,
    extraHeadersSecret: _extraHeadersSecret,
    oauthConfig: _oauthConfig,
    oauth_config: _oauthConfigSnake,
    oauthCredentials: _oauthCredentials,
    oauth_credentials: _oauthCredentialsSnake,
    ...safeProvider
  } = provider;
  return safeProvider;
}
