import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-1',
    };
  },
  withScope: () => async () => {},
}));

describe('events routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('supports work-item, stage, activation, and gate filters on event queries', async () => {
    const { eventRoutes } = await import('../../src/api/routes/events.routes.js');
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            type: 'work_item.updated',
            entity_type: 'work_item',
            entity_id: 'wi-1',
            data: {
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              stage_name: 'implementation',
              activation_id: 'activation-1',
              gate_id: 'gate-1',
            },
          },
        ],
        rowCount: 1,
      });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { query });
    app.decorate('eventStreamService', { subscribe: vi.fn(), subscribeAll: vi.fn() });
    app.decorate('config', { EVENT_STREAM_KEEPALIVE_INTERVAL_MS: 30_000, EVENT_STREAM_PATH: '/api/v1/events/stream' });
    await app.register(eventRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/events?workflow_id=wf-1&work_item_id=wi-1&stage_name=implementation&activation_id=activation-1&gate_id=gate-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const [countSql, countParams] = query.mock.calls[0];
    const [selectSql, selectParams] = query.mock.calls[1];

    expect(countSql).toContain("COALESCE(data->>'workflow_id', '') = $");
    expect(countSql).toContain("COALESCE(data->>'work_item_id', CASE WHEN entity_type = 'work_item' THEN entity_id::text ELSE '' END) = $");
    expect(countSql).toContain("COALESCE(data->>'stage_name', '') = $");
    expect(countSql).toContain("COALESCE(data->>'activation_id', '') = $");
    expect(countSql).toContain("COALESCE(data->>'gate_id', '') = $");
    expect(countParams.slice(0, 6)).toEqual([
      'tenant-1',
      'wf-1',
      'wi-1',
      'implementation',
      'activation-1',
      'gate-1',
    ]);
    expect(selectParams).toEqual(['tenant-1', 'wf-1', 'wi-1', 'implementation', 'activation-1', 'gate-1', 20, 0]);
  });
});
