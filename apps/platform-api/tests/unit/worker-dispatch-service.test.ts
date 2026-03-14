import { describe, expect, it, vi } from 'vitest';

import { WorkerConnectionHub } from '../../src/services/worker-connection-hub.js';
import { dispatchReadyTasks } from '../../src/services/worker-dispatch-service.js';

describe('dispatchReadyTasks', () => {
  it('short-circuits before querying ready tasks when no workers are connected', async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error('dispatch should not query the database without connected workers');
      }),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const context = {
      pool,
      eventService,
      connectionHub: new WorkerConnectionHub(),
      config: {
        WORKER_DISPATCH_BATCH_LIMIT: 25,
        WORKER_DISPATCH_ACK_TIMEOUT_MS: 5_000,
        WORKER_RECONNECT_MIN_MS: 250,
        WORKER_RECONNECT_MAX_MS: 5_000,
      },
    };

    const dispatched = await dispatchReadyTasks(context as never);

    expect(dispatched).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalled();
  });
});
