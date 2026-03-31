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

  it('returns the richer cost dashboard summary payload', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM metering_events WHERE')) {
        return {
          rowCount: 1,
          rows: [{
            total_tokens_input: '40',
            total_tokens_output: '20',
            total_cost_usd: '1.50',
            total_wall_time_ms: '900',
            event_count: '2',
            today_cost: '1.25',
            week_cost: '1.50',
            month_cost: '1.50',
          }],
        };
      }
      if (sql.includes('FROM metering_events me')) {
        return {
          rowCount: 1,
          rows: [{ name: 'Board Alpha', cost: '1.50' }],
        };
      }
      if (sql.includes("to_char(date_trunc('day', created_at)")) {
        return {
          rowCount: 1,
          rows: [{ day: '2026-03-13', cost: '1.50' }],
        };
      }
      if (sql.includes('FROM workflows')) {
        return {
          rowCount: 1,
          rows: [{ budget_total: '4.00' }],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    app = fastify();
    app.decorate('pgPool', { query });
    app.decorate('workflowService', { evaluateWorkflowBudget: vi.fn() });
    await app.register(meteringRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/metering/summary',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      today: 1.25,
      this_week: 1.5,
      this_month: 1.5,
      budget_total: 4,
      budget_remaining: 2.5,
      by_workflow: [{ name: 'Board Alpha', cost: 1.5 }],
      by_model: [],
      daily_trend: [{ date: '2026-03-13', cost: 1.5 }],
      totalTokensInput: 40,
      totalTokensOutput: 20,
      totalCostUsd: 1.5,
      totalWallTimeMs: 900,
      eventCount: 2,
    });
  });
});
