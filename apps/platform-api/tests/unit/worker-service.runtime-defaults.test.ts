import { describe, expect, it, vi, afterEach } from 'vitest';

import { WorkerConnectionHub } from '../../src/services/worker-connection-hub.js';
import * as workerDispatchModule from '../../src/services/worker-dispatch-service.js';
import * as workerHeartbeatModule from '../../src/services/worker-heartbeat-service.js';
import * as workerRegistrationModule from '../../src/services/worker-registration-service.js';
import { WorkerService } from '../../src/services/worker-service.js';

function buildRuntimeDefaultPool(overrides: Record<string, string>) {
  return {
    query: vi.fn(async (_sql: string, params?: unknown[]) => {
      const key = String(params?.[1] ?? '');
      return overrides[key]
        ? { rowCount: 1, rows: [{ config_value: overrides[key] }] }
        : { rowCount: 0, rows: [] };
    }),
  };
}

describe('WorkerService runtime-default timing overrides', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the runtime default worker heartbeat interval when registering workers', async () => {
    const pool = buildRuntimeDefaultPool({
      'platform.worker_default_heartbeat_interval_seconds': '45',
    });
    const registerSpy = vi.spyOn(workerRegistrationModule, 'registerWorker').mockImplementation(
      async (context) => {
        expect(context.config.WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS).toBe(45);
        expect(context.config.WORKER_DISPATCH_ACK_TIMEOUT_MS).toBe(15_000);
        return {
          worker_id: 'worker-1',
          worker_api_key: 'wk',
          agents: [],
          websocket_url: '/ws',
          heartbeat_interval_seconds: 45,
        };
      },
    );
    const service = new WorkerService(
      pool as never,
      { emit: vi.fn(async () => undefined) } as never,
      new WorkerConnectionHub(),
      {
        WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: 30,
        WORKER_DISPATCH_ACK_TIMEOUT_MS: 15_000,
        WORKER_OFFLINE_GRACE_PERIOD_MS: 300_000,
        WORKER_OFFLINE_THRESHOLD_MULTIPLIER: 2,
        WORKER_DEGRADED_THRESHOLD_MULTIPLIER: 1,
      } as never,
    );

    const result = await service.registerWorker(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerId: null,
        ownerType: 'user',
        id: 'admin-key',
        keyPrefix: 'admin',
      } as never,
      { name: 'worker-a' },
    );

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(result.heartbeat_interval_seconds).toBe(45);
  });

  it('uses the runtime default dispatch acknowledgement timeout when dispatching tasks', async () => {
    const pool = buildRuntimeDefaultPool({
      'platform.worker_dispatch_ack_timeout_ms': '12000',
    });
    const dispatchSpy = vi.spyOn(workerDispatchModule, 'dispatchReadyTasks').mockImplementation(
      async (context, limit) => {
        expect(context.config.WORKER_DISPATCH_ACK_TIMEOUT_MS).toBe(12_000);
        expect(limit).toBe(7);
        return 3;
      },
    );
    const service = new WorkerService(
      pool as never,
      { emit: vi.fn(async () => undefined) } as never,
      new WorkerConnectionHub(),
      {
        WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: 30,
        WORKER_DISPATCH_ACK_TIMEOUT_MS: 15_000,
        WORKER_OFFLINE_GRACE_PERIOD_MS: 300_000,
        WORKER_OFFLINE_THRESHOLD_MULTIPLIER: 2,
        WORKER_DEGRADED_THRESHOLD_MULTIPLIER: 1,
      } as never,
    );

    const dispatched = await service.dispatchReadyTasks(7);

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatched).toBe(3);
  });

  it('uses runtime-default offline thresholds when enforcing worker heartbeat timeouts', async () => {
    const pool = buildRuntimeDefaultPool({
      'platform.worker_offline_grace_period_ms': '450000',
      'platform.worker_offline_threshold_multiplier': '3',
      'platform.worker_degraded_threshold_multiplier': '1.5',
    });
    const heartbeatSpy = vi.spyOn(workerHeartbeatModule, 'enforceHeartbeatTimeouts').mockImplementation(
      async (context, now) => {
        expect(context.config.WORKER_OFFLINE_GRACE_PERIOD_MS).toBe(450_000);
        expect(context.config.WORKER_OFFLINE_THRESHOLD_MULTIPLIER).toBe(3);
        expect(context.config.WORKER_DEGRADED_THRESHOLD_MULTIPLIER).toBe(1.5);
        expect(now?.toISOString()).toBe('2026-03-16T02:10:00.000Z');
        return 2;
      },
    );
    const service = new WorkerService(
      pool as never,
      { emit: vi.fn(async () => undefined) } as never,
      new WorkerConnectionHub(),
      {
        WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: 30,
        WORKER_DISPATCH_ACK_TIMEOUT_MS: 15_000,
        WORKER_OFFLINE_GRACE_PERIOD_MS: 300_000,
        WORKER_OFFLINE_THRESHOLD_MULTIPLIER: 2,
        WORKER_DEGRADED_THRESHOLD_MULTIPLIER: 1,
      } as never,
    );

    const affected = await service.enforceHeartbeatTimeouts(new Date('2026-03-16T02:10:00.000Z'));

    expect(heartbeatSpy).toHaveBeenCalledTimes(1);
    expect(affected).toBe(2);
  });
});
