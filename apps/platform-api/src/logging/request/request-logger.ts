import type { FastifyInstance } from 'fastify';

import { getRequestContext } from '../../observability/request-context.js';
import { actorFromAuth } from './actor-context.js';
import type { LogService } from '../log-service.js';

const SKIP_PATHS = new Set([
  // Health / metrics — internal probes, no observability value
  '/health',
  '/health/detail',
  '/metrics',
  // Log endpoints — would create recursive logging feedback loop
  '/api/v1/logs',
  '/api/v1/logs/ingest',
  '/api/v1/logs/:id',
  '/api/v1/logs/stats',
  '/api/v1/logs/operations',
  '/api/v1/logs/roles',
  '/api/v1/logs/actors',
  '/api/v1/logs/workflows',
  '/api/v1/logs/export',
  // Heartbeats — high-frequency (every 5-60s per worker/agent/runtime)
  '/api/v1/fleet/heartbeat',
  '/api/v1/workers/:id/heartbeat',
  '/api/v1/agents/:id/heartbeat',
  '/api/v1/acp/sessions/:id/heartbeat',
  // Fleet polling — called every reconcile cycle (5s)
  '/api/v1/fleet/status',
  '/api/v1/fleet/heartbeats',
  '/api/v1/fleet/runtime-targets',
  '/api/v1/fleet/workers',
  // Fleet event ingestion — container-manager reports every cycle
  '/api/v1/fleet/events',
  '/api/v1/fleet/workers/actual-state',
  '/api/v1/fleet/workers/actual-state/prune',
  '/api/v1/fleet/reconcile-snapshot',
  // Image inventory — container-manager scans and reports every cycle
  '/api/v1/fleet/images',
  // Queue depth polling and task claim polling
  '/api/v1/tasks/queue-depth',
  '/api/v1/tasks/claim',
  // SSE streams — single long-lived connection, not request/response
  '/api/v1/events/stream',
  '/api/v1/logs/stream',
  '/api/v1/a2a/tasks/:id/events',
]);

export function registerRequestLogger(app: FastifyInstance, logService: LogService): void {
  app.addHook('onResponse', async (request, reply) => {
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') return;

    const routePath = request.routeOptions?.url ?? request.url;
    if (SKIP_PATHS.has(routePath)) return;

    const duration = Math.round(reply.elapsedTime);
    const level = reply.statusCode >= 500 ? 'error'
      : reply.statusCode >= 400 ? 'warn'
        : 'debug';
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
      level: level as 'debug' | 'info' | 'warn' | 'error',
      operation: `api.${method.toLowerCase()}.${normalizeRoute(routePath)}`,
      status: status as 'completed' | 'failed',
      durationMs: duration,
      payload: {
        method,
        path: sanitizeRequestPath(request.url, routePath),
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

function sanitizeRequestPath(url: string, routePath: string): string {
  if (routePath && routePath.startsWith('/')) {
    return routePath;
  }
  return stripQueryString(url);
}

function stripQueryString(url: string): string {
  const [path] = url.split('?', 1);
  return path || url;
}
