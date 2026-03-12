import { describe, expect, it, vi } from 'vitest';

import { enforceHeartbeatTimeouts } from '../../src/services/worker-heartbeat-service.js';

describe('worker heartbeat timeout enforcement', () => {
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
});
