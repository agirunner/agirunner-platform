import fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { executeRoutes } from '../../src/api/routes/execute.routes.js';

describe('execute route impossible-scope policy alignment', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  async function createApp(): Promise<FastifyInstance> {
    app = fastify();
    await app.register(executeRoutes);
    return app;
  }

  it('rejects canonical impossible rewrite objectives', async () => {
    const server = await createApp();

    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        title: 'Impossible migration objective',
        input: {
          goal: 'Rewrite the entire application in Rust with no JavaScript remaining',
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: 'impossible_scope',
    });
  });

  it('does not reject ordinary Rust mentions without impossible constraints', async () => {
    const server = await createApp();

    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        type: 'code',
        title: 'Performance enhancement task',
        input: {
          goal: 'Add a Rust benchmark module for one endpoint',
          repo: 'perf-tooling',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      execution_mode: 'live-agent-api',
      role: 'developer',
    });
  });

  it('rejects tasks explicitly marked with deterministic impossible failure mode', async () => {
    const server = await createApp();

    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        title: 'Normal objective text',
        context: {
          failure_mode: 'deterministic_impossible',
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: 'impossible_scope',
    });
  });
});
