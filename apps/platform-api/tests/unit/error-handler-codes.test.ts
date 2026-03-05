import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

describe('error handler fallback codes', () => {
  const apps: Array<Awaited<ReturnType<typeof Fastify>>> = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) {
        await app.close();
      }
    }
  });

  it('maps 429 non-domain errors to RATE_LIMITED', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    registerErrorHandler(app);

    app.get('/rate-limited', async () => {
      const error = Object.assign(new Error('Too many requests'), { statusCode: 429 });
      throw error;
    });

    const response = await app.inject({ method: 'GET', url: '/rate-limited' });
    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('RATE_LIMITED');
  });

  it('maps 503 non-domain errors to SERVICE_UNAVAILABLE', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    registerErrorHandler(app);

    app.get('/unavailable', async () => {
      const error = Object.assign(new Error('Service unavailable'), { statusCode: 503 });
      throw error;
    });

    const response = await app.inject({ method: 'GET', url: '/unavailable' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
