import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withAllowedScopes, withScope } from '../../auth/fastify-auth-hook.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../pagination.js';
import { SchemaValidationFailedError, ValidationError } from '../../errors/domain-errors.js';
import type { PublicTaskState } from '../../services/task-service.types.js';
import { WorkflowToolResultService } from '../../services/workflow-tool-result-service.js';
import {
  runIdempotentPublicTaskOperatorAction,
  runIdempotentWorkflowBackedTaskRouteAction,
} from './task-route-idempotency.js';


const taskCreateSchema = z.object({
  title: z.string().min(1).max(500),
  type: z.enum(['analysis', 'code', 'review', 'test', 'docs', 'orchestration', 'custom']),
  description: z.string().max(5000).optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  workflow_id: z.string().uuid().optional(),
  work_item_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  stage_name: z.string().max(120).optional(),
  activation_id: z.string().uuid().optional(),
  request_id: z.string().max(255).optional(),
  is_orchestrator_task: z.boolean().optional(),
  parent_id: z.string().uuid().optional(),
  role: z.string().max(120).optional(),
  input: z.record(z.unknown()).optional(),
  context: z.record(z.unknown()).optional(),
  depends_on: z.array(z.string().uuid()).optional(),
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
  retry_policy: z.record(z.unknown()).optional(),
});

const taskPatchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  capabilities_required: z.array(z.string().min(1)).max(20).optional(),
  timeout_minutes: z.number().int().min(1).max(240).optional(),
  metadata: z.record(z.unknown()).optional(),
  parent_id: z.string().uuid().optional(),
  state: z.never().optional(),
});

const claimSchema = z.object({
  agent_id: z.string().uuid(),
  worker_id: z.string().uuid().optional(),
  capabilities: z.array(z.string()).default([]),
  workflow_id: z.string().uuid().optional(),
  playbook_id: z.string().uuid().optional(),
  include_context: z.boolean().optional(),
});

const claimCredentialResolveSchema = z.object({
  llm_api_key_claim_handle: z.string().min(1).optional(),
  llm_extra_headers_claim_handle: z.string().min(1).optional(),
}).refine(
  (value) => Boolean(value.llm_api_key_claim_handle || value.llm_extra_headers_claim_handle),
  { message: 'At least one claim credential handle is required.' },
);

const taskControlSchema = z.object({
  agent_id: z.string().uuid().optional(),
  worker_id: z.string().uuid().optional(),
  started_at: z.string().datetime().optional(),
});

const taskOperatorMutationSchema = z.object({
  request_id: z.string().min(1).max(255).optional(),
});

const completeSchema = taskOperatorMutationSchema.extend({
  output: z.any(),
  metrics: z.record(z.unknown()).optional(),
  git_info: z.record(z.unknown()).optional(),
  verification: z.record(z.unknown()).optional(),
  agent_id: z.string().uuid().optional(),
  worker_id: z.string().uuid().optional(),
});
const failSchema = taskOperatorMutationSchema.extend({
  error: z.record(z.unknown()),
  metrics: z.record(z.unknown()).optional(),
  git_info: z.record(z.unknown()).optional(),
  agent_id: z.string().uuid().optional(),
  worker_id: z.string().uuid().optional(),
});

const retrySchema = taskOperatorMutationSchema.extend({
  override_input: z.record(z.unknown()).optional(),
  force: z.boolean().optional(),
});

const rejectSchema = taskOperatorMutationSchema.extend({
  feedback: z.string().min(1).max(4000),
});

const requestChangesSchema = taskOperatorMutationSchema.extend({
  feedback: z.string().min(1).max(4000),
  override_input: z.record(z.unknown()).optional(),
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
});

const skipSchema = taskOperatorMutationSchema.extend({
  reason: z.string().min(1).max(4000),
});

const reassignSchema = taskOperatorMutationSchema.extend({
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
  reason: z.string().min(1).max(4000),
});

const escalateSchema = taskOperatorMutationSchema.extend({
  reason: z.string().min(1).max(4000),
  escalation_target: z.string().max(255).optional(),
});

const escalationResponseSchema = taskOperatorMutationSchema.extend({
  instructions: z.string().min(1).max(4000),
  context: z.record(z.unknown()).optional(),
});

const agentEscalateSchema = taskOperatorMutationSchema.extend({
  reason: z.string().min(1).max(4000),
  context_summary: z.string().max(4000).optional(),
  work_so_far: z.string().max(8000).optional(),
});

const resolveEscalationSchema = taskOperatorMutationSchema.extend({
  instructions: z.string().min(1).max(4000),
  context: z.record(z.unknown()).optional(),
});

const overrideOutputSchema = taskOperatorMutationSchema.extend({
  output: z.unknown(),
  reason: z.string().min(1).max(4000),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

const publicTaskStateFilters = new Set<PublicTaskState>([
  'pending',
  'ready',
  'claimed',
  'in_progress',
  'awaiting_approval',
  'output_pending_review',
  'escalated',
  'completed',
  'failed',
  'cancelled',
]);

function parseTaskStateFilter(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }
  if (!publicTaskStateFilters.has(value as PublicTaskState)) {
    throw new ValidationError(`Invalid task state '${value}'`);
  }
  return value;
}

export const taskRoutes: FastifyPluginAsync = async (app) => {
  const taskService = app.taskService;
  const toolResultService = new WorkflowToolResultService(app.pgPool);
  const runPublicTaskOperatorAction = <T extends Record<string, unknown>>(
    tenantId: string,
    taskId: string,
    toolName: string,
    requestId: string | undefined,
    run: (client: import('../../db/database.js').DatabaseClient | undefined) => Promise<T>,
  ) =>
    runIdempotentPublicTaskOperatorAction(
      app,
      toolResultService,
      taskService.getTask.bind(taskService),
      tenantId,
      taskId,
      toolName,
      requestId,
      run,
    );
  const runWorkflowBackedTaskRouteAction = <T extends Record<string, unknown>>(
    tenantId: string,
    taskId: string,
    toolName: string,
    requestId: string | undefined,
    run: (client: import('../../db/database.js').DatabaseClient | undefined) => Promise<T>,
  ) =>
    runIdempotentWorkflowBackedTaskRouteAction(
      app,
      toolResultService,
      taskService.getTask.bind(taskService),
      tenantId,
      taskId,
      toolName,
      requestId,
      run,
    );

  app.post(
    '/api/v1/tasks',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const body = parseOrThrow(taskCreateSchema.safeParse(request.body));
      const task = await taskService.createTask(request.auth!, body);
      return reply.status(201).send({ data: task });
    },
  );

  app.get(
    '/api/v1/tasks',
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

      const result = await taskService.listTasks(request.auth!.tenantId, {
        state: parseTaskStateFilter(query.state),
        project_id: query.project_id,
        assigned_agent_id: query.assigned_agent_id,
        parent_id: query.parent_id,
        workflow_id: query.workflow_id,
        work_item_id: query.work_item_id,
        stage_name: query.stage_name,
        activation_id: query.activation_id,
        is_orchestrator_task:
          query.is_orchestrator_task === undefined
            ? undefined
            : query.is_orchestrator_task === 'true',
        page,
        per_page: perPage,
      });

      return result;
    },
  );

  app.get(
    '/api/v1/tasks/:id',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const task = await taskService.getTask(request.auth!.tenantId, params.id);
      return { data: task };
    },
  );

  app.patch(
    '/api/v1/tasks/:id',
    { preHandler: [authenticateApiKey, withScope('worker')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(taskPatchSchema.safeParse(request.body));
      const task = await taskService.updateTask(request.auth!.tenantId, params.id, body);
      return { data: task };
    },
  );

  app.get(
    '/api/v1/tasks/:id/context',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as { agent_id?: string };
      const context = await taskService.getTaskContext(
        request.auth!.tenantId,
        params.id,
        query.agent_id,
      );
      return { data: context };
    },
  );

  app.get(
    '/api/v1/tasks/:id/git',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const git = await taskService.getTaskGitActivity(request.auth!.tenantId, params.id);
      return { data: git };
    },
  );

  app.post(
    '/api/v1/tasks/claim',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const body = parseOrThrow(claimSchema.safeParse(request.body));
      const task = await taskService.claimTask(request.auth!, body);
      if (!task) {
        return reply.status(204).send();
      }
      return reply.status(200).send({ data: task });
    },
  );

  app.post(
    '/api/v1/tasks/:id/claim-credentials',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(claimCredentialResolveSchema.safeParse(request.body));
      const credentials = await taskService.resolveClaimCredentials(request.auth!, params.id, body);
      return { data: credentials };
    },
  );

  app.post(
    '/api/v1/tasks/:id/start',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(taskControlSchema.safeParse(request.body));
      const task = await taskService.startTask(request.auth!, params.id, body);
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/complete',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(completeSchema.safeParse(request.body));
      const requestId = body.request_id;
      const task = await runWorkflowBackedTaskRouteAction(
        request.auth!.tenantId,
        params.id,
        'task_complete',
        requestId,
        () =>
          taskService.completeTask(request.auth!, params.id, {
            output: body.output,
            metrics: body.metrics,
            git_info: body.git_info,
            verification: body.verification,
            agent_id: body.agent_id,
            worker_id: body.worker_id,
          }),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/fail',
    { preHandler: [authenticateApiKey, withAllowedScopes(['agent', 'worker', 'admin'])] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(failSchema.safeParse(request.body));
      const requestId = body.request_id;
      const task = await runWorkflowBackedTaskRouteAction(
        request.auth!.tenantId,
        params.id,
        'task_fail',
        requestId,
        () =>
          taskService.failTask(request.auth!, params.id, {
            error: body.error,
            metrics: body.metrics,
            git_info: body.git_info,
            agent_id: body.agent_id,
            worker_id: body.worker_id,
          }),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/approve',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'worker'])] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(taskOperatorMutationSchema.safeParse(request.body ?? {}));
      const task = await runPublicTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_approve',
        body.request_id,
        (client) => taskService.approveTask(request.auth!, params.id, client),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/approve-output',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'worker'])] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(taskOperatorMutationSchema.safeParse(request.body ?? {}));
      const task = await runPublicTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_approve_output',
        body.request_id,
        (client) => taskService.approveTaskOutput(request.auth!, params.id, client),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/retry',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'worker'])] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(retrySchema.safeParse(request.body ?? {}));
      const { request_id: requestId, ...payload } = body;
      const task = await runPublicTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_retry',
        requestId,
        (client) => taskService.retryTask(request.auth!, params.id, payload, client),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/cancel',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'worker'])] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(taskOperatorMutationSchema.safeParse(request.body ?? {}));
      const task = await runPublicTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_cancel',
        body.request_id,
        (client) => taskService.cancelTask(request.auth!, params.id, client),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/reject',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'worker'])] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(rejectSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      const task = await runPublicTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_reject',
        requestId,
        () => taskService.rejectTask(request.auth!, params.id, payload),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/rework',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'worker'])] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(requestChangesSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      const task = await runPublicTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_request_changes',
        requestId,
        (client) => taskService.requestTaskChanges(request.auth!, params.id, payload, client),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/request-changes',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'worker'])] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(requestChangesSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      const task = await runPublicTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_request_changes',
        requestId,
        (client) => taskService.requestTaskChanges(request.auth!, params.id, payload, client),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/skip',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'worker'])] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(skipSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      const task = await runPublicTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_skip',
        requestId,
        () => taskService.skipTask(request.auth!, params.id, payload),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/reassign',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(reassignSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      const task = await runPublicTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_reassign',
        requestId,
        (client) => taskService.reassignTask(request.auth!, params.id, payload, client),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/escalate',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(escalateSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      const task = await runPublicTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_escalate',
        requestId,
        (client) => taskService.escalateTask(request.auth!, params.id, payload, client),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/escalation-response',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(escalationResponseSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      const task = await runPublicTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_escalation_response',
        requestId,
        () => taskService.respondToEscalation(request.auth!, params.id, payload),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/output-override',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(overrideOutputSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      const task = await runPublicTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_output_override',
        requestId,
        () =>
          taskService.overrideTaskOutput(request.auth!, params.id, {
            output: payload.output,
            reason: payload.reason,
          }),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/agent-escalate',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'worker', 'agent'])] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(agentEscalateSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      const task = await runPublicTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_agent_escalate',
        requestId,
        () => taskService.agentEscalate(request.auth!, params.id, payload),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/resolve-escalation',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'worker'])] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(resolveEscalationSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      const task = await runPublicTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_resolve_escalation',
        requestId,
        () => taskService.resolveEscalation(request.auth!, params.id, payload),
      );
      return { data: task };
    },
  );
};
