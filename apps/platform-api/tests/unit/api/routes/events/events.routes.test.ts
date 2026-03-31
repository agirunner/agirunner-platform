import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
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
    const { eventRoutes } = await import('../../../../../src/api/routes/events/events.routes.js');
    const query = vi
      .fn()
      .mockResolvedValue({
        rows: [
          {
            id: 19,
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
      url: '/api/v1/events?entity_type=work_item&workflow_id=wf-1&work_item_id=wi-1&stage_name=implementation&activation_id=activation-1&gate_id=gate-1&types=work_item.updated&after=20&limit=10',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const [selectSql, selectParams] = query.mock.calls[0];

    expect(selectSql).toContain(
      "COALESCE(data->>'workflow_id', CASE WHEN entity_type = 'workflow' THEN entity_id::text ELSE '' END) = $",
    );
    expect(selectSql).toContain(
      "COALESCE(data->>'work_item_id', CASE WHEN entity_type = 'work_item' THEN entity_id::text ELSE '' END) = $",
    );
    expect(selectSql).toContain("COALESCE(data->>'stage_name', '') = $");
    expect(selectSql).toContain("COALESCE(data->>'activation_id', '') = $");
    expect(selectSql).toContain("COALESCE(data->>'gate_id', CASE WHEN entity_type = 'gate' THEN entity_id::text ELSE '' END) = $");
    expect(selectSql).toContain('entity_type::text = ANY(');
    expect(selectSql).toContain('type = ANY(');
    expect(selectSql).toContain('id < $');
    expect(selectSql).toContain('ORDER BY id DESC');
    expect(selectParams).toEqual([
      'tenant-1',
      ['work_item'],
      'wf-1',
      'wi-1',
      'implementation',
      'activation-1',
      'gate-1',
      ['work_item.updated'],
      20,
      11,
    ]);
    expect(response.json()).toEqual({
      data: [
        {
          id: 19,
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
      meta: {
        has_more: false,
        next_after: null,
      },
    });
  });

  it('redacts secret-bearing event data in list responses', async () => {
    const { eventRoutes } = await import('../../../../../src/api/routes/events/events.routes.js');
    const query = vi
      .fn()
      .mockResolvedValue({
        rows: [
          {
            id: 1,
            type: 'workflow.activation_stale_detected',
            entity_type: 'workflow',
            entity_id: 'wf-1',
            data: {
              workflow_id: 'wf-1',
              activation_id: 'activation-1',
              api_key: 'sk-secret-value',
              headers: {
                Authorization: 'Bearer top-secret-token',
              },
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
      url: '/api/v1/events?workflow_id=wf-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [
        {
          id: 1,
          type: 'workflow.activation_stale_detected',
          entity_type: 'workflow',
          entity_id: 'wf-1',
          data: {
            workflow_id: 'wf-1',
            activation_id: 'activation-1',
            api_key: 'redacted://event-secret',
            headers: {
              Authorization: 'redacted://event-secret',
            },
          },
        },
      ],
      meta: {
        has_more: false,
        next_after: null,
      },
    });
  });

  it('accepts per_page as an alias for limit on event queries', async () => {
    const { eventRoutes } = await import('../../../../../src/api/routes/events/events.routes.js');
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { query });
    app.decorate('eventStreamService', { subscribe: vi.fn(), subscribeAll: vi.fn() });
    app.decorate('config', { EVENT_STREAM_KEEPALIVE_INTERVAL_MS: 30_000, EVENT_STREAM_PATH: '/api/v1/events/stream' });
    await app.register(eventRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/events?workflow_id=wf-1&per_page=25',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const [, selectParams] = query.mock.calls[0];
    expect(selectParams.at(-1)).toBe(26);
  });
});
