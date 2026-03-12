import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { meteringRoutes } from '../../src/api/routes/metering.routes.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'worker',
      ownerType: 'worker',
      ownerId: 'worker-1',
      keyPrefix: 'worker-1',
    };
  },
  withScope: () => async () => {},
}));

describe('meteringRoutes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('re-evaluates the workflow budget when a metering event is recorded for a workflow', async () => {
    const evaluateWorkflowBudget = vi.fn(async () => undefined);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO metering_events')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'meter-1',
            tenant_id: 'tenant-1',
            task_id: 'task-1',
            workflow_id: 'workflow-1',
            worker_id: 'worker-1',
            agent_id: null,
            tokens_input: 10,
            tokens_output: 20,
            cost_usd: 0.25,
            wall_time_ms: 500,
            cpu_ms: null,
            memory_peak_bytes: null,
            network_bytes: null,
            created_at: new Date('2026-03-12T00:00:00.000Z'),
          }],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    app = fastify();
    app.decorate('pgPool', { query });
    app.decorate('workflowService', { evaluateWorkflowBudget });
    await app.register(meteringRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/metering/events',
      headers: { authorization: 'Bearer test' },
      payload: {
        taskId: '11111111-1111-4111-8111-111111111111',
        workflowId: '22222222-2222-4222-8222-222222222222',
        tokensInput: 10,
        tokensOutput: 20,
        costUsd: 0.25,
        wallTimeMs: 500,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(evaluateWorkflowBudget).toHaveBeenCalledWith(
      'tenant-1',
      '22222222-2222-4222-8222-222222222222',
    );
  });
});
