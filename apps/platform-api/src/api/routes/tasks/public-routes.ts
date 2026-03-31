import type { FastifyInstance } from 'fastify';

import { authenticateApiKey, withAllowedScopes, withScope } from '../../../auth/fastify-auth-hook.js';
import { ValidationError } from '../../../errors/domain-errors.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../../../lib/pagination.js';
import { parseExecutionBackendFilter, parseOptionalUuidFilter, parseTaskId, parseTaskStateFilter } from './filters.js';
import {
  claimCredentialResolveSchema,
  claimSchema,
  parseOrThrow,
  taskCreateSchema,
} from './schemas.js';

export async function registerTaskPublicRoutes(app: FastifyInstance) {
  const taskService = app.taskService;

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

      return taskService.listTasks(request.auth!.tenantId, {
        state: parseTaskStateFilter(query.state),
        workspace_id: parseOptionalUuidFilter(query.workspace_id, 'workspace_id'),
        assigned_agent_id: parseOptionalUuidFilter(query.assigned_agent_id, 'assigned_agent_id'),
        parent_id: parseOptionalUuidFilter(query.parent_id, 'parent_id'),
        workflow_id: parseOptionalUuidFilter(query.workflow_id, 'workflow_id'),
        work_item_id: parseOptionalUuidFilter(query.work_item_id, 'work_item_id'),
        escalation_task_id: query.escalation_task_id,
        stage_name: query.stage_name,
        activation_id: parseOptionalUuidFilter(query.activation_id, 'activation_id'),
        execution_backend: parseExecutionBackendFilter(query.execution_backend),
        is_orchestrator_task:
          query.is_orchestrator_task === undefined
            ? undefined
            : query.is_orchestrator_task === 'true',
        page,
        per_page: perPage,
      });
    },
  );

  app.get(
    '/api/v1/tasks/:id',
    { preHandler: [authenticateApiKey, withAllowedScopes(['agent', 'admin'])] },
    async (request) => {
      const params = request.params as { id: string };
      const taskId = parseTaskId(params.id);
      const task = await taskService.getTask(request.auth!.tenantId, taskId);
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
}
