import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../pagination.js';
import { SchemaValidationFailedError, ValidationError } from '../../errors/domain-errors.js';
import { EventService } from '../../services/event-service.js';
import { TaskService } from '../../services/task-service.js';

const taskCreateSchema = z.object({
  title: z.string().min(1).max(500),
  type: z.enum(['analysis', 'code', 'review', 'test', 'docs', 'orchestration', 'custom']),
  description: z.string().max(5000).optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  pipeline_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  parent_id: z.string().uuid().optional(),
  role: z.string().max(120).optional(),
  input: z.record(z.unknown()).optional(),
  context: z.record(z.unknown()).optional(),
  depends_on: z.array(z.string().uuid()).optional(),
  requires_approval: z.boolean().optional(),
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
  pipeline_id: z.string().uuid().optional(),
  include_context: z.boolean().optional(),
});

const taskControlSchema = z.object({
  agent_id: z.string().uuid().optional(),
  worker_id: z.string().uuid().optional(),
  started_at: z.string().datetime().optional(),
});

const completeSchema = z.object({
  output: z.any(),
  metrics: z.record(z.unknown()).optional(),
  git_info: z.record(z.unknown()).optional(),
  verification: z.record(z.unknown()).optional(),
  agent_id: z.string().uuid().optional(),
  worker_id: z.string().uuid().optional(),
});
const failSchema = z.object({
  error: z.record(z.unknown()),
  metrics: z.record(z.unknown()).optional(),
  git_info: z.record(z.unknown()).optional(),
  agent_id: z.string().uuid().optional(),
  worker_id: z.string().uuid().optional(),
});

const retrySchema = z.object({
  override_input: z.record(z.unknown()).optional(),
  force: z.boolean().optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const taskRoutes: FastifyPluginAsync = async (app) => {
  const taskService = new TaskService(app.pgPool, new EventService(app.pgPool), app.config, app.workerConnectionHub);

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
        state: query.state,
        type: query.type,
        project_id: query.project_id,
        assigned_agent_id: query.assigned_agent_id,
        parent_id: query.parent_id,
        pipeline_id: query.pipeline_id,
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
      const task = await taskService.completeTask(request.auth!, params.id, {
        output: body.output,
        metrics: body.metrics,
        git_info: body.git_info,
        verification: body.verification,
        agent_id: body.agent_id,
        worker_id: body.worker_id,
      });
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/fail',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(failSchema.safeParse(request.body));
      const task = await taskService.failTask(request.auth!, params.id, body);
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/approve',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const task = await taskService.approveTask(request.auth!, params.id);
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/retry',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(retrySchema.safeParse(request.body ?? {}));
      const task = await taskService.retryTask(request.auth!, params.id, body);
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/cancel',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const task = await taskService.cancelTask(request.auth!, params.id);
      return { data: task };
    },
  );
};
