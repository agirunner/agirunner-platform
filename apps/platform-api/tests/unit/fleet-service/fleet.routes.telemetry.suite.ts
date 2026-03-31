import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../src/errors/error-handler.js';
import { createFleetServiceMock } from './support.js';

vi.mock('../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
}));

describe('fleet routes telemetry', () => {
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

  it('accepts snake_case actual-state payloads from workers', async () => {
    const { fleetRoutes } = await import('../../../src/api/routes/fleet/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    const reportActualState = vi.fn().mockResolvedValue(undefined);
    app.decorate('fleetService', createFleetServiceMock({ reportActualState }));

    await app.register(fleetRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fleet/workers/actual-state',
      headers: { authorization: 'Bearer test' },
      payload: {
        desired_state_id: '00000000-0000-0000-0000-000000000111',
        container_id: 'container-1',
        container_status: 'running',
        cpu_usage_percent: 12.5,
        memory_usage_bytes: 2048,
        network_rx_bytes: 100,
        network_tx_bytes: 200,
      },
    });

    expect(response.statusCode).toBe(204);
    expect(reportActualState).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000111',
      'container-1',
      'running',
      {
        cpuPercent: 12.5,
        memoryBytes: 2048,
        rxBytes: 100,
        txBytes: 200,
      },
    );
  });

  it('returns 400 instead of 500 when actual-state payload is missing required ids', async () => {
    const { fleetRoutes } = await import('../../../src/api/routes/fleet/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    const reportActualState = vi.fn().mockResolvedValue(undefined);
    app.decorate('fleetService', createFleetServiceMock({ reportActualState }));

    await app.register(fleetRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fleet/workers/actual-state',
      headers: { authorization: 'Bearer test' },
      payload: {
        container_status: 'running',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(reportActualState).not.toHaveBeenCalled();
  });

  it('wraps fleet heartbeat responses in the standard data envelope', async () => {
    const { fleetRoutes } = await import('../../../src/api/routes/fleet/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('fleetService', createFleetServiceMock({
      recordHeartbeat: vi.fn().mockResolvedValue({
        runtime_id: 'runtime-1',
        playbook_id: 'playbook-1',
        pool_kind: 'orchestrator',
        state: 'idle',
        task_id: null,
        should_drain: false,
      }),
    }));

    await app.register(fleetRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fleet/heartbeat',
      headers: { authorization: 'Bearer test' },
      payload: {
        runtime_id: '00000000-0000-0000-0000-000000000111',
        playbook_id: '00000000-0000-0000-0000-000000000222',
        pool_kind: 'orchestrator',
        state: 'idle',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        runtime_id: 'runtime-1',
        playbook_id: 'playbook-1',
        pool_kind: 'orchestrator',
        state: 'idle',
        task_id: null,
        should_drain: false,
      },
    });
  });

  it('deletes fleet heartbeats idempotently', async () => {
    const { fleetRoutes } = await import('../../../src/api/routes/fleet/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    const removeHeartbeat = vi.fn().mockResolvedValue(undefined);
    app.decorate('fleetService', createFleetServiceMock({ removeHeartbeat }));

    await app.register(fleetRoutes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/fleet/heartbeats/runtime-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(204);
    expect(removeHeartbeat).toHaveBeenCalledWith('tenant-1', 'runtime-1');
  });
});
