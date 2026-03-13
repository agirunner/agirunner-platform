import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../pagination.js';
import { SchemaValidationFailedError, ValidationError } from '../../errors/domain-errors.js';
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
import { WorkflowChainingService } from '../../services/workflow-chaining-service.js';
import { PlaybookWorkflowControlService } from '../../services/playbook-workflow-control-service.js';
import { WorkflowActivationDispatchService } from '../../services/workflow-activation-dispatch-service.js';
import { WorkflowActivationService } from '../../services/workflow-activation-service.js';
import { WorkflowStateService } from '../../services/workflow-state-service.js';
import { WorkflowToolResultService } from '../../services/workflow-tool-result-service.js';

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
  project_id: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  parameters: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  config_overrides: z.record(z.unknown()).optional(),
  instruction_config: z.record(z.unknown()).optional(),
  budget: workflowBudgetSchema.optional(),
  model_overrides: modelOverridesSchema.optional(),
});

const stageGateSchema = z.object({
  request_id: z.string().min(1).max(255).optional(),
  action: z.enum(['approve', 'reject', 'request_changes']),
  feedback: z.string().min(1).max(4000).optional(),
});

const workflowChainSchema = z.object({
  request_id: z.string().min(1).max(255).optional(),
  playbook_id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  parameters: z.record(z.unknown()).optional(),
});

const workflowControlMutationSchema = z.object({
  request_id: z.string().min(1).max(255).optional(),
});

const workItemCreateSchema = z.object({
  request_id: z.string().min(1).max(255).optional(),
  parent_work_item_id: z.string().uuid().optional(),
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

const workflowDocumentCreateSchema = z.object({
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
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

function parseCsv(raw?: string): string[] | undefined {
  return raw?.split(',').map((value) => value.trim()).filter(Boolean);
}

export const workflowRoutes: FastifyPluginAsync = async (app) => {
  const workflowService = app.workflowService;
  const workflowChainingService = new WorkflowChainingService(app.pgPool, workflowService);
  const approvalQueueService = new ApprovalQueueService(app.pgPool);
  const eventQueryService = new EventQueryService(app.pgPool);
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
  });

  app.post(
    '/api/v1/workflows',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const body = parseOrThrow(workflowCreateSchema.safeParse(request.body));
      const workflow = await workflowService.createWorkflow(request.auth!, {
        ...body,
        metadata: mergeWorkflowMetadata(body.metadata, body.model_overrides),
      });
      return reply.status(201).send({ data: workflow });
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
        project_id: query.project_id,
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
        limit: parseCursorLimit(query.limit),
      });
    },
  );

  app.get(
    '/api/v1/workflows/:id/gates',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await approvalQueueService.listWorkflowGates(request.auth!.tenantId, params.id) };
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
      const workItem = await workflowService.createWorkflowWorkItem(request.auth!, params.id, body);
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

  app.get(
    '/api/v1/workflows/:id/work-items/:workItemId/events',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string; workItemId: string };
      const query = request.query as { limit?: string };
      const limit = query.limit === undefined ? 100 : Number(query.limit);
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
      return {
        data: await workflowService.updateWorkflowWorkItem(
          request.auth!,
          params.id,
          params.workItemId,
          body,
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/stages/:name/gate',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string; name: string };
      const body = parseOrThrow(stageGateSchema.safeParse(request.body));
      const { request_id: requestId, ...decision } = body;
      return {
        data: await runIdempotentGateDecision(
          app,
          toolResultService,
          request.auth!.tenantId,
          params.id,
          'act_on_stage_gate',
          requestId,
          (client) => playbookControlService.actOnStageGate(request.auth!, params.id, params.name, decision, client),
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
      const gate = await runIdempotentGateDecision(
        app,
        toolResultService,
        request.auth!.tenantId,
        params.id,
        'act_on_gate',
        requestId,
        (client) => playbookControlService.actOnGate(request.auth!, params.gateId, decision, client),
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
      const document = await createWorkflowDocument(app.pgPool, request.auth!.tenantId, params.id, body);
      return reply.status(201).send({ data: document });
    },
  );

  app.patch(
    '/api/v1/workflows/:id/documents/:logicalName',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string; logicalName: string };
      const body = parseOrThrow(workflowDocumentUpdateSchema.safeParse(request.body));
      return {
        data: await updateWorkflowDocument(
          app.pgPool,
          request.auth!.tenantId,
          params.id,
          decodeURIComponent(params.logicalName),
          body,
        ),
      };
    },
  );

  app.delete(
    '/api/v1/workflows/:id/documents/:logicalName',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string; logicalName: string };
      await deleteWorkflowDocument(
        app.pgPool,
        request.auth!.tenantId,
        params.id,
        decodeURIComponent(params.logicalName),
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
      const projectId = typeof workflow.project_id === 'string' ? workflow.project_id : null;
      const projectOverrides = projectId
        ? readModelOverrides(
            asRecord(asRecord((await app.projectService.getProject(request.auth!.tenantId, projectId)).settings).model_overrides),
          )
        : {};
      const roles = parseRoleQuery(query.roles, workflowOverrides, projectOverrides);
      return {
        data: {
          workflow_id: params.id,
          project_id: projectId,
          project_model_overrides: projectOverrides,
          workflow_model_overrides: workflowOverrides,
          effective_models: await resolveEffectiveModels(
            app.modelCatalogService,
            request.auth!.tenantId,
            roles,
            projectOverrides,
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

async function runIdempotentGateDecision<T extends Record<string, unknown>>(
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

function parseRoleQuery(
  raw: string | undefined,
  workflowOverrides: Record<string, unknown>,
  projectOverrides: Record<string, unknown>,
) {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.split(',').map((value) => value.trim()).filter(Boolean);
  }
  return Array.from(new Set([...Object.keys(projectOverrides), ...Object.keys(workflowOverrides)]));
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
  projectOverrides: Record<string, unknown>,
  workflowOverrides: Record<string, unknown>,
) {
  const providers = (await modelCatalogService.listProviders(tenantId)) as Array<Record<string, unknown>>;
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
    const baseResolved = (await modelCatalogService.resolveRoleConfig(tenantId, role)) as
      | Record<string, unknown>
      | null;
    const workflowOverride = asRecord(workflowOverrides[role]);
    const projectOverride = asRecord(projectOverrides[role]);
    const activeOverride = Object.keys(workflowOverride).length > 0 ? workflowOverride : projectOverride;
    const source =
      Object.keys(workflowOverride).length > 0
        ? 'workflow'
        : Object.keys(projectOverride).length > 0
          ? 'project'
          : 'base';

    if (Object.keys(activeOverride).length === 0) {
      results[role] = { source, resolved: baseResolved, fallback: baseResolved === null };
      continue;
    }

    const providerRef = String(activeOverride.provider);
    const provider = byId.get(providerRef) ?? byName.get(providerRef);
    if (!provider) {
      results[role] = {
        source,
        resolved: baseResolved,
        fallback: true,
        fallback_reason: `provider '${providerRef}' is not available`,
      };
      continue;
    }

    const models = (await modelCatalogService.listModels(
      tenantId,
      String(provider.id),
    )) as Array<Record<string, unknown>>;
    const model = models.find(
      (entry) =>
        String((entry as Record<string, unknown>).model_id) === String(activeOverride.model)
        && (entry as Record<string, unknown>).is_enabled === true,
    );
    if (!model) {
      results[role] = {
        source,
        resolved: baseResolved,
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
            ? (baseResolved as Record<string, unknown> | null)?.reasoningConfig ?? null
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
