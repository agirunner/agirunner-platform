import { describe, expect, it, vi } from 'vitest';

import { TaskTimeoutService } from '../../../src/services/task-timeout-service.js';

describe('TaskTimeoutService timeout signal lifecycle', () => {
  it('queues cancel signal and marks timeout grace metadata for in-progress worker task', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'task-1',
              tenant_id: 'tenant-1',
              state: 'in_progress',
              assigned_worker_id: 'worker-1',
              metadata: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'task-1' }] }),
    };

    const applyTransition = vi.fn();
    const queueWorkerCancelSignal = vi.fn().mockResolvedValue('signal-1');

    const service = new TaskTimeoutService(
      pool as never,
      applyTransition as never,
      queueWorkerCancelSignal,
      async () => 60_000,
    );

    const now = new Date('2026-03-05T00:00:00.000Z');
    const affected = await service.failTimedOutTasks(now);

    expect(affected).toBe(1);
    expect(queueWorkerCancelSignal).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', scope: 'admin' }),
      'worker-1',
      'task-1',
      'task_timeout',
      expect.any(Date),
    );
    expect(applyTransition).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE tasks'),
      expect.arrayContaining(['tenant-1', 'task-1']),
    );
  });

  it('force-fails timeout tasks once grace deadline is exceeded', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'task-2',
            tenant_id: 'tenant-2',
            state: 'in_progress',
            assigned_worker_id: 'worker-2',
            metadata: {
              timeout_force_fail_at: '2026-03-05T00:00:00.000Z',
            },
          },
        ],
      }),
    };

    const applyTransition = vi.fn().mockResolvedValue({ state: 'failed' });
    const queueWorkerCancelSignal = vi.fn();

    const service = new TaskTimeoutService(
      pool as never,
      applyTransition as never,
      queueWorkerCancelSignal,
      async () => 60_000,
    );

    const affected = await service.failTimedOutTasks(new Date('2026-03-05T00:01:00.000Z'));

    expect(affected).toBe(1);
    expect(queueWorkerCancelSignal).not.toHaveBeenCalled();
    expect(applyTransition).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-2', scope: 'admin' }),
      'task-2',
      'failed',
      expect.objectContaining({
        expectedStates: ['claimed', 'in_progress'],
        reason: 'timeout_force_failed',
        clearLifecycleControlMetadata: true,
      }),
    );
  });
});
