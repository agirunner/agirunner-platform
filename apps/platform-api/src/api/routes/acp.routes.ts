import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';

const sessionSchema = z.object({
  agent_id: z.string().uuid(),
  worker_id: z.string().uuid().optional(),
  workflow_id: z.string().uuid().optional(),
  transport: z.enum(['stdio', 'http', 'websocket']),
  mode: z.enum(['run', 'session']),
  workspace_path: z.string().min(1).max(2000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const claimSchema = z.object({
  agent_id: z.string().uuid(),
  worker_id: z.string().uuid().optional(),
  routing_tags: z.array(z.string().min(1)).optional(),
  workflow_id: z.string().uuid().optional(),
  include_context: z.boolean().optional(),
  session: sessionSchema.omit({ agent_id: true }),
}).strict();

const heartbeatSchema = z.object({
  status: z.enum(['initializing', 'active', 'idle', 'closed']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const outputSchema = z.object({
  session_id: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
  worker_id: z.string().uuid().optional(),
  content: z.unknown().optional(),
  terminal_output: z.string().optional(),
  diff: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  result: z.unknown().optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const acpRoutes: FastifyPluginAsync = async (app) => {
  const taskService = app.taskService;
  const sessionService = app.acpSessionService;

  app.post('/api/v1/acp/sessions', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request, reply) => {
    const body = parseOrThrow(sessionSchema.safeParse(request.body));
    const session = await sessionService.createOrReuseSession(request.auth!, body);
    return reply.status(session.reused ? 200 : 201).send({ data: session });
  });

  app.get('/api/v1/acp/sessions/:id', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const session = await sessionService.getSession(request.auth!.tenantId, params.id);
    return { data: session };
  });

  app.post('/api/v1/acp/sessions/:id/heartbeat', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(heartbeatSchema.safeParse(request.body ?? {}));
    const session = await sessionService.heartbeat(request.auth!, params.id, body);
    return { data: session };
  });

  app.post('/api/v1/acp/claim', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request, reply) => {
    const body = parseOrThrow(claimSchema.safeParse(request.body));
    const claimed = await taskService.claimTask(request.auth!, {
      agent_id: body.agent_id,
      worker_id: body.worker_id,
      routing_tags: body.routing_tags ?? ['acp'],
      workflow_id: body.workflow_id,
      include_context: body.include_context ?? true,
    });
    if (!claimed) {
      return reply.status(204).send();
    }

    await taskService.startTask(request.auth!, String(claimed.id), {
      agent_id: body.agent_id,
      worker_id: body.worker_id,
    });

    const session = await sessionService.createOrReuseSession(request.auth!, {
      agent_id: body.agent_id,
      worker_id: body.worker_id,
      workflow_id: (claimed.workflow_id as string | null) ?? body.workflow_id,
      transport: body.session.transport,
      mode: body.session.mode,
      workspace_path:
        body.session.workspace_path ??
        readWorkspacePath(claimed.context) ??
        readWorkspacePath(claimed.input),
      metadata: body.session.metadata,
    });

    return {
      data: {
        session,
        task: {
          id: claimed.id,
          title: claimed.title,
          prompt: claimed.description ?? claimed.title,
          cwd: session.workspace_path ?? null,
          input: claimed.input ?? {},
          context: claimed.context ?? {},
          file_references: readFileReferences(claimed.context),
        },
      },
    };
  });

  app.post('/api/v1/acp/tasks/:id/output', { preHandler: [authenticateApiKey, withScope('agent')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(outputSchema.safeParse(request.body));
    const task = await taskService.completeTask(request.auth!, params.id, {
      output: sessionService.normalizeOutput(body),
      agent_id: body.agent_id,
      worker_id: body.worker_id,
    });
    return { data: task };
  });
};

function readWorkspacePath(value: unknown) {
  const record = asRecord(value);
  const workspace = asRecord(record.workspace);
  const path = workspace.path ?? record.workspace_path ?? record.cwd;
  return typeof path === 'string' && path.length > 0 ? path : undefined;
}

function readFileReferences(value: unknown) {
  const record = asRecord(value);
  const documents = Array.isArray(record.documents) ? record.documents : [];
  return documents.filter((entry) => entry && typeof entry === 'object');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
