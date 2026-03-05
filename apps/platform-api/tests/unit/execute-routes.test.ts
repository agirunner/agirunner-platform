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
      execution_mode: 'simulated-not-executed',
      role: 'developer',
      simulated: true,
      authenticity_gate_hint: 'NOT_PASS',
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

  it('returns simulation-marked output and never emits concrete diff payload fields', async () => {
    const server = await createApp();

    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        type: 'test',
        task_id: 'task-42',
        input: {
          repo: 'todo-app',
          issue: 'pagination',
          goal: 'Fix issue #123',
          instruction: 'Generate a real diff',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;

    expect(body.execution_mode).toBe('simulated-not-executed');
    expect(body.simulated).toBe(true);
    expect(body.authenticity_gate_hint).toBe('NOT_PASS');
    expect(String(body.summary)).toContain('NOT EXECUTION-BACKED');
    expect(body.patch).toBeUndefined();
    expect(body.changed_files).toBeUndefined();
    expect(body.tests).toBeUndefined();
  });

  it('captures pipeline id from nested task context for traceability', async () => {
    const server = await createApp();

    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        type: 'code',
        context: {
          task: {
            pipeline_id: 'pipeline-from-task-context',
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      pipeline_id: 'pipeline-from-task-context',
      execution_mode: 'simulated-not-executed',
      authenticity_gate_hint: 'NOT_PASS',
    });
  });
});
