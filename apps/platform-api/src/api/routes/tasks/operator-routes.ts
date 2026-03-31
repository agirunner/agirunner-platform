import type { FastifyInstance } from 'fastify';

import { authenticateApiKey, withAllowedScopes, withScope } from '../../../auth/fastify-auth-hook.js';
import { WorkflowToolResultService } from '../../../services/workflow-operations/workflow-tool-result-service.js';
import {
  runIdempotentPublicTaskOperatorAction,
  runIdempotentTaskRouteAction,
} from '../task-platform/route-idempotency.js';
import {
  assertRawTaskOperatorActionAllowed,
} from './filters.js';
import {
  agentEscalateSchema,
  completeSchema,
  escalateSchema,
  escalationResponseSchema,
  failSchema,
  overrideOutputSchema,
  parseOrThrow,
  rejectSchema,
  reassignSchema,
  requestChangesSchema,
  resolveEscalationSchema,
  retrySchema,
  skipSchema,
  taskOperatorMutationSchema,
  taskPatchSchema,
  taskControlSchema,
} from './schemas.js';

export async function registerTaskOperatorRoutes(app: FastifyInstance) {
  const taskService = app.taskService;
  const toolResultService = new WorkflowToolResultService(app.pgPool);

  const runPublicTaskOperatorAction = <T extends Record<string, unknown>>(
    tenantId: string,
    taskId: string,
    toolName: string,
    requestId: string | undefined,
    run: (client: import('../../../db/database.js').DatabaseClient | undefined) => Promise<T>,
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

  const runStandaloneTaskOperatorAction = async <T extends Record<string, unknown>>(
    tenantId: string,
    taskId: string,
    toolName: string,
    requestId: string | undefined,
    run: (client: import('../../../db/database.js').DatabaseClient | undefined) => Promise<T>,
  ) => {
    await assertRawTaskOperatorActionAllowed(taskService.getTask.bind(taskService), tenantId, taskId);
    return runPublicTaskOperatorAction(tenantId, taskId, toolName, requestId, run);
  };

  const runTaskRouteAction = <T extends Record<string, unknown>>(
    tenantId: string,
    taskId: string,
    toolName: string,
    requestId: string | undefined,
    run: (client: import('../../../db/database.js').DatabaseClient | undefined) => Promise<T>,
  ) =>
    runIdempotentTaskRouteAction(
      app,
      toolResultService,
      taskService.getTask.bind(taskService),
      tenantId,
      taskId,
      toolName,
      requestId,
      run,
    );

  app.patch(
    '/api/v1/tasks/:id',
    { preHandler: [authenticateApiKey, withAllowedScopes(['worker', 'admin'])] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(taskPatchSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      const task = await runTaskRouteAction(
        request.auth!.tenantId,
        params.id,
        'task_update',
        requestId,
        () => taskService.updateTask(request.auth!.tenantId, params.id, payload),
      );
      return { data: task };
    },
  );

  app.post(
    '/api/v1/tasks/:id/start',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(taskControlSchema.safeParse(request.body));
      const { request_id: requestId, ...payload } = body;
      const task = await runTaskRouteAction(
        request.auth!.tenantId,
        params.id,
        'task_start',
        requestId,
        () => taskService.startTask(request.auth!, params.id, payload),
      );
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
      const task = await runTaskRouteAction(
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
      const task = await runTaskRouteAction(
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
      const task = await runStandaloneTaskOperatorAction(
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
      const task = await runStandaloneTaskOperatorAction(
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
      const task = await runStandaloneTaskOperatorAction(
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
      const task = await runStandaloneTaskOperatorAction(
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
      const task = await runStandaloneTaskOperatorAction(
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
      const task = await runStandaloneTaskOperatorAction(
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
      const task = await runStandaloneTaskOperatorAction(
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
      const task = await runStandaloneTaskOperatorAction(
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
      const task = await runStandaloneTaskOperatorAction(
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
      const task = await runStandaloneTaskOperatorAction(
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
      const task = await runStandaloneTaskOperatorAction(
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
      const task = await runStandaloneTaskOperatorAction(
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
      const task = await runStandaloneTaskOperatorAction(
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
      const task = await runStandaloneTaskOperatorAction(
        request.auth!.tenantId,
        params.id,
        'public_task_resolve_escalation',
        requestId,
        () => taskService.resolveEscalation(request.auth!, params.id, payload),
      );
      return { data: task };
    },
  );
}
