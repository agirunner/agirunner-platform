import type { FastifyInstance, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { isRealtimeTransportRoute, rateLimitKeyGenerator } from '../../src/bootstrap/plugins.js';

function createRequest(overrides: Partial<FastifyRequest>): FastifyRequest {
  return {
    headers: {},
    ip: '127.0.0.1',
    raw: { url: '/unknown' },
    routeOptions: { url: '/unknown' } as FastifyRequest['routeOptions'],
    ...overrides,
  } as FastifyRequest;
}

function createAppConfig(overrides: Partial<FastifyInstance['config']> = {}): FastifyInstance {
  return {
    config: {
      EVENT_STREAM_PATH: '/api/v1/events/stream',
      WORKER_WEBSOCKET_PATH: '/api/v1/events',
      ...overrides,
    },
  } as FastifyInstance;
}

describe('rate limit helpers', () => {
  it('scopes rate limit keys by route and token', () => {
    const request = createRequest({
      headers: { authorization: 'Bearer ab_admin_def_local_dev_123456789012345' },
      routeOptions: { url: '/api/v1/pipelines' } as FastifyRequest['routeOptions'],
    });

    expect(rateLimitKeyGenerator(request)).toBe('/api/v1/pipelines:key:ab_admin_def_local_dev_1');
  });

  it('detects realtime transport routes for limiter allow-listing', () => {
    const app = createAppConfig();
    const request = createRequest({
      routeOptions: { url: '/api/v1/events/stream' } as FastifyRequest['routeOptions'],
    });

    expect(isRealtimeTransportRoute(app, request)).toBe(true);
  });

  it('does not classify standard API routes as realtime transport', () => {
    const app = createAppConfig();
    const request = createRequest({
      routeOptions: { url: '/api/v1/pipelines' } as FastifyRequest['routeOptions'],
    });

    expect(isRealtimeTransportRoute(app, request)).toBe(false);
  });
});
