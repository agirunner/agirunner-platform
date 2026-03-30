import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  isRetryableDatabaseStartupError,
  registerPoolErrorLogging,
  runDatabaseListenerStartupWithRetry,
  runDatabaseStartupWithRetry,
} from '../../src/db/startup-resilience.js';

describe('startup resilience', () => {
  it('classifies transient database startup failures as retryable', () => {
    expect(isRetryableDatabaseStartupError(Object.assign(new Error('dns wobble'), { code: 'EAI_AGAIN' }))).toBe(true);
    expect(
      isRetryableDatabaseStartupError(
        Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }),
      ),
    ).toBe(true);
    expect(isRetryableDatabaseStartupError(new Error('permanent bad config'))).toBe(false);
  });

  it('retries transient startup failures and then succeeds', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const operation = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(Object.assign(new Error('temporary dns'), { code: 'EAI_AGAIN' }))
      .mockResolvedValueOnce(undefined);

    await runDatabaseStartupWithRetry(operation, {
      logger,
      retries: 2,
      delayMs: 0,
      label: 'run migrations',
    });

    expect(operation).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('retries transient listener startup failures and then succeeds', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const startListener = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(Object.assign(new Error('temporary dns'), { code: 'EAI_AGAIN' }))
      .mockResolvedValueOnce(undefined);

    await runDatabaseListenerStartupWithRetry(startListener, {
      logger,
      retries: 2,
      delayMs: 0,
      label: 'workflow event listener',
    });

    expect(startListener).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('registers a pool error handler that logs idle-client failures', () => {
    const pool = new EventEmitter() as EventEmitter & { on: typeof EventEmitter.prototype.on };
    const logger = { warn: vi.fn(), error: vi.fn() };

    registerPoolErrorLogging(pool, logger, 'platform database pool');
    pool.emit('error', Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ code: '57P01' }),
      }),
      'platform database pool error',
    );
  });
});
