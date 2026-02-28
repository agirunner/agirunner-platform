import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { parseBearerToken } from '../auth/api-key.js';
import { requestCounter, requestDuration } from '../observability/metrics.js';

function rateLimitKeyGenerator(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (!authorization) {
    return request.ip;
  }

  try {
    const token = parseBearerToken(authorization);
    return `key:${token.slice(0, 24)}`;
  } catch {
    return request.ip;
  }
}

export async function registerPlugins(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, { secret: app.config.JWT_SECRET });
  await app.register(fastifyRateLimit, {
    global: true,
    max: app.config.RATE_LIMIT_MAX_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyGenerator,
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
