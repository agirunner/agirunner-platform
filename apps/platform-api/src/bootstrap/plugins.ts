import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { parseBearerToken } from '../auth/api-key.js';
import { requestCounter, requestDuration } from '../observability/metrics.js';

export function resolveRateLimitRoute(request: FastifyRequest): string {
  return request.routeOptions.url ?? request.raw.url ?? 'unknown';
}

export function isRealtimeTransportRoute(app: FastifyInstance, request: FastifyRequest): boolean {
  const route = resolveRateLimitRoute(request);
  return route === app.config.EVENT_STREAM_PATH || route === '/api/v1/events/ws' || route === app.config.WORKER_WEBSOCKET_PATH || route === '/api/v1/logs/stream';
}

export function rateLimitKeyGenerator(request: FastifyRequest): string {
  const route = resolveRateLimitRoute(request);
  const authorization = request.headers.authorization;
  if (!authorization) {
    return `${route}:ip:${request.ip}`;
  }

  try {
    const token = parseBearerToken(authorization);
    return `${route}:key:${token.slice(0, 24)}`;
  } catch {
    return `${route}:ip:${request.ip}`;
  }
}

function normalizeEnvelope(
  request: FastifyRequest,
  payload: unknown,
): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const responseObject = payload as Record<string, unknown>;
  if (!('data' in responseObject) && !('error' in responseObject)) {
    return payload;
  }

  const existingMeta =
    responseObject.meta && typeof responseObject.meta === 'object' && !Array.isArray(responseObject.meta)
      ? (responseObject.meta as Record<string, unknown>)
      : {};

  return {
    ...responseObject,
    meta: {
      ...existingMeta,
      request_id: existingMeta.request_id ?? request.id,
      timestamp:
        typeof existingMeta.timestamp === 'string'
          ? existingMeta.timestamp
          : new Date().toISOString(),
    },
  };
}

export async function registerPlugins(app: FastifyInstance): Promise<void> {
  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin: app.config.CORS_ORIGIN,
    credentials: true,
  });
  await app.register(fastifyJwt, { secret: app.config.JWT_SECRET });
  await app.register(fastifyRateLimit, {
    global: true,
    max: app.config.RATE_LIMIT_MAX_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyGenerator,
    allowList: (request) => request.method === 'OPTIONS' || isRealtimeTransportRoute(app, request),
  });

  app.addHook('preSerialization', (request, _reply, payload, done) => {
    done(null, normalizeEnvelope(request, payload));
  });

  app.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions.url ?? 'unknown';
    const status = reply.statusCode.toString();
    const labels = { method: request.method, route, status_code: status };
    requestCounter.inc(labels);
    const responseTimeSeconds = reply.elapsedTime / 1000;
    requestDuration.observe(labels, responseTimeSeconds);
    done();
  });
}
