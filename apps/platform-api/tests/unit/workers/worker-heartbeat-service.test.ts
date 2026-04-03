import { describe, expect, it, vi } from 'vitest';

import { enforceHeartbeatTimeouts, heartbeat } from '../../../src/services/workers/worker-heartbeat-service.js';

describe('worker heartbeat timeout enforcement', () => {
  it('releases stale claimed task leases when the worker reports no current task', async () => {
    const identity = {
      tenantId: 'tenant-1',
      scope: 'worker' as const,
      ownerId: 'worker-1',
    };
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT * FROM workers')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'worker-1',
                tenant_id: 'tenant-1',
                status: 'busy',
                last_heartbeat_at: '2026-04-03T03:49:00.000Z',
              },
            ],
          };
        }
        if (sql.startsWith('UPDATE workers')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes("state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{ id: 'task-stale' }],
          };
        }
        if (sql.includes("SET state = 'ready'")) {
          return {
            rowCount: 1,
            rows: [{ id: 'task-stale' }],
          };
        }
        if (sql.includes('UPDATE agents')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('FROM worker_signals')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const context = {
      pool,
      eventService,
      config: {
        WORKER_OFFLINE_THRESHOLD_MULTIPLIER: 3,
        WORKER_DEGRADED_THRESHOLD_MULTIPLIER: 2,
        WORKER_OFFLINE_GRACE_PERIOD_MS: 5_000,
      },
    };

    const result = await heartbeat(context as never, identity as never, 'worker-1', {
      status: 'online',
      current_task_id: null,
    });

    expect(result).toEqual({ ack: true, pending_signals: [] });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('AND claimed_at <= $3::timestamptz'),
      ['tenant-1', 'worker-1', '2026-04-03T03:49:00.000Z'],
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'ready'"),
      ['tenant-1', ['task-stale']],
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'task-stale',
        data: expect.objectContaining({
          from_state: 'claimed',
          to_state: 'ready',
          reason: 'worker_reported_no_current_task',
          worker_id: 'worker-1',
        }),
      }),
    );
  });

  it('does not release a freshly claimed task on the first empty heartbeat after claim', async () => {
    const identity = {
      tenantId: 'tenant-1',
      scope: 'worker' as const,
      ownerId: 'worker-1',
    };
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT * FROM workers')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'worker-1',
                tenant_id: 'tenant-1',
                status: 'busy',
                last_heartbeat_at: '2026-04-03T03:49:00.000Z',
              },
            ],
          };
        }
        if (sql.startsWith('UPDATE workers')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes("state = 'claimed'")) {
          return {
            rowCount: 0,
            rows: [],
          };
        }
        if (sql.includes('UPDATE agents')) {
          throw new Error('fresh claims must not clear agent ownership');
        }
        if (sql.includes("SET state = 'ready'")) {
          throw new Error('fresh claims must not be released');
        }
        if (sql.includes('FROM worker_signals')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const context = {
      pool,
      eventService,
      config: {
        WORKER_OFFLINE_THRESHOLD_MULTIPLIER: 3,
        WORKER_DEGRADED_THRESHOLD_MULTIPLIER: 2,
        WORKER_OFFLINE_GRACE_PERIOD_MS: 5_000,
      },
    };

    const result = await heartbeat(context as never, identity as never, 'worker-1', {
      status: 'online',
      current_task_id: null,
    });

    expect(result).toEqual({ ack: true, pending_signals: [] });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('AND claimed_at <= $3::timestamptz'),
      ['tenant-1', 'worker-1', '2026-04-03T03:49:00.000Z'],
    );
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('fails in-progress/claimed tasks after offline grace window elapses', async () => {
    const now = new Date('2026-03-05T00:00:00.000Z');
    const lastHeartbeat = new Date(now.getTime() - 50_000).toISOString();

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workers')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'worker-1',
                tenant_id: 'tenant-1',
                status: 'busy',
                heartbeat_interval_seconds: 10,
                last_heartbeat_at: lastHeartbeat,
              },
            ],
          };
        }
        if (sql.includes("UPDATE workers SET status = 'offline'")) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE agents')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE tasks')) {
          return {
            rowCount: 2,
            rows: [{ id: 'task-1' }, { id: 'task-2' }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const context = {
      pool,
      eventService,
      config: {
        WORKER_OFFLINE_THRESHOLD_MULTIPLIER: 3,
        WORKER_DEGRADED_THRESHOLD_MULTIPLIER: 2,
        WORKER_OFFLINE_GRACE_PERIOD_MS: 5_000,
      },
    };

    const affected = await enforceHeartbeatTimeouts(context as never, now);

    expect(affected).toBe(3);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'worker.offline', entityId: 'worker-1' }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.state_changed', entityId: 'task-1' }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.state_changed', entityId: 'task-2' }),
    );
  });

  it('skips offline workers after timeout cleanup has already completed', async () => {
    const now = new Date('2026-03-05T00:00:00.000Z');
    const lastHeartbeat = new Date(now.getTime() - 50_000).toISOString();

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workers')) {
          if (sql.includes("status IN ('online', 'busy', 'draining', 'degraded', 'disconnected', 'offline')")) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: 'worker-1',
                  tenant_id: 'tenant-1',
                  status: 'offline',
                  heartbeat_interval_seconds: 10,
                  last_heartbeat_at: lastHeartbeat,
                },
              ],
            };
          }

          return { rowCount: 0, rows: [] };
        }

        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const context = {
      pool,
      eventService,
      config: {
        WORKER_OFFLINE_THRESHOLD_MULTIPLIER: 3,
        WORKER_DEGRADED_THRESHOLD_MULTIPLIER: 2,
        WORKER_OFFLINE_GRACE_PERIOD_MS: 5_000,
      },
    };

    const affected = await enforceHeartbeatTimeouts(context as never, now);

    expect(affected).toBe(0);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(eventService.emit).not.toHaveBeenCalled();
  });
});
