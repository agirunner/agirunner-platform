import type { FastifyInstance } from 'fastify';

import { getRequestContext } from '../observability/request-context.js';
import { actorFromAuth } from './actor-context.js';
import type { LogService } from './log-service.js';

const SKIP_PATHS = new Set(['/health', '/metrics', '/api/v1/logs/ingest']);

export function registerRequestLogger(app: FastifyInstance, logService: LogService): void {
  app.addHook('onResponse', async (request, reply) => {
    const routePath = request.routeOptions?.url ?? request.url;
    if (SKIP_PATHS.has(routePath)) return;

    const duration = Math.round(reply.elapsedTime);
    const level = reply.statusCode >= 500 ? 'error'
      : reply.statusCode >= 400 ? 'warn'
        : 'info';
    const status = reply.statusCode >= 400 ? 'failed' : 'completed';

    const ctx = getRequestContext();
    const actor = actorFromAuth(ctx?.auth);
    const tenantId = ctx?.auth?.tenantId ?? '00000000-0000-0000-0000-000000000000';

    void logService.insert({
      tenantId,
      traceId: request.id as string,
      spanId: request.id as string,
      source: 'platform',
      category: 'api',
      level: level as 'info' | 'warn' | 'error',
      operation: `api.${request.method.toLowerCase()}.${normalizeRoute(routePath)}`,
      status: status as 'completed' | 'failed',
      durationMs: duration,
      metadata: {
        method: request.method,
        path: request.url,
        route: routePath,
        status_code: reply.statusCode,
        request_id: request.id,
        source_ip: ctx?.sourceIp,
        user_agent: request.headers['user-agent'],
      },
      actorType: actor.type,
      actorId: actor.id,
      actorName: actor.name,
    }).catch(() => undefined);
  });
}

function normalizeRoute(route: string): string {
  return route
    .replace(/^\/api\/v1\//, '')
    .replace(/\/:[^/]+/g, '.:param')
    .replace(/\//g, '.');
}
