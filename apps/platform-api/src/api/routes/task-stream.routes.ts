import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';

const KEEPALIVE_INTERVAL_MS = 15_000;
const TASK_EVENTS_PATH = '/api/v1/tasks';
const RUNTIME_EVENTS_SUFFIX = '/events';

function buildUpstreamUrl(apiUrl: string, taskId: string, query: Record<string, string | undefined>): string {
  const base = `${apiUrl}${TASK_EVENTS_PATH}/${taskId}${RUNTIME_EVENTS_SUFFIX}`;
  const params = new URLSearchParams();
  if (query.agent_id) params.set('agent_id', query.agent_id);
  if (query.from_turn) params.set('from_turn', query.from_turn);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export const taskStreamRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [authenticateApiKey, withScope('agent')] };

  app.get('/api/v1/tasks/:id/stream', auth, async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { agent_id?: string; from_turn?: string };
    const id = params.id;

    const authenticatedRequest = request as typeof request & { auth?: { tenantId: string } };
    const tenantId = authenticatedRequest.auth!.tenantId;

    const task = await app.taskService.getTask(tenantId, id);

    if (!task || task.state !== 'in_progress' || !task.assigned_worker_id) {
      return reply.status(404).send({ error: 'task_not_streaming' });
    }

    const worker = await app.workerService.getWorker(tenantId, task.assigned_worker_id);
    const hostInfo = (worker as Record<string, unknown>)?.host_info as Record<string, unknown> | undefined;
    const apiUrl = hostInfo?.api_url as string | undefined;

    if (!worker || !apiUrl) {
      return reply.status(502).send({ error: 'runtime_unreachable' });
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.write(': connected\n\n');

    const upstreamUrl = buildUpstreamUrl(apiUrl, id, query);
    const controller = new AbortController();

    const keepAlive = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, KEEPALIVE_INTERVAL_MS);

    request.raw.on('close', () => {
      clearInterval(keepAlive);
      controller.abort();
    });

    const adminApiKey = process.env.DEFAULT_ADMIN_API_KEY ?? '';

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${adminApiKey}`,
          Accept: 'text/event-stream',
        },
      });
    } catch {
      clearInterval(keepAlive);
      reply.raw.write('event: error\ndata: {"error":"upstream_fetch_failed"}\n\n');
      reply.raw.end();
      return reply;
    }

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      clearInterval(keepAlive);
      reply.raw.write('event: error\ndata: {"error":"upstream_unavailable"}\n\n');
      reply.raw.end();
      return reply;
    }

    try {
      const reader = upstreamResponse.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply.raw.write(decoder.decode(value, { stream: true }));
      }
    } catch {
      // Client disconnected or upstream closed — fall through to cleanup
    }

    clearInterval(keepAlive);
    reply.raw.write('event: task_end\ndata: {}\n\n');
    reply.raw.end();

    return reply;
  });
};
