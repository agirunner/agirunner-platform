import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LogStreamService } from '../../../../../src/logging/log-stream-service.js';
import { createMockPool, sampleRow } from './support.js';

describe('LogStreamService lifecycle and reconnect behavior', () => {
  let mockPool: ReturnType<typeof createMockPool>;
  let service: LogStreamService;

  beforeEach(() => {
    mockPool = createMockPool();
    service = new LogStreamService(mockPool.pool as never);
  });

  it('startsListeningOnChannel', async () => {
    await service.start();
    expect(mockPool.client.query).toHaveBeenCalledWith('LISTEN agirunner_execution_logs');
    expect(mockPool.client.on).toHaveBeenCalledWith('notification', expect.any(Function));
  });

  it('doesNotStartTwice', async () => {
    await service.start();
    await service.start();
    expect(mockPool.pool.connect).toHaveBeenCalledTimes(1);
  });

  it('stopsAndReleasesClient', async () => {
    await service.start();
    await service.stop();
    expect(mockPool.client.query).toHaveBeenCalledWith('UNLISTEN agirunner_execution_logs');
    expect(mockPool.client.release).toHaveBeenCalled();
  });

  it('reconnects after the listener client errors', async () => {
    vi.useFakeTimers();
    const firstClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      on: vi.fn(),
      release: vi.fn(),
    };
    const secondClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      on: vi.fn(),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi
        .fn()
        .mockResolvedValueOnce(firstClient)
        .mockResolvedValueOnce(secondClient),
    };
    const reconnectingService = new LogStreamService(pool as never);

    await reconnectingService.start();
    const errorHandler = firstClient.on.mock.calls.find((call: unknown[]) => call[0] === 'error')?.[1] as
      | ((error: Error) => void)
      | undefined;

    errorHandler?.(new Error('connection lost'));
    await vi.runAllTimersAsync();

    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(firstClient.release).toHaveBeenCalledTimes(1);
    expect(secondClient.query).toHaveBeenCalledWith('LISTEN agirunner_execution_logs');
    vi.useRealTimers();
  });

  it('reconnects after fetching a notified log row fails', async () => {
    vi.useFakeTimers();
    const firstClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      on: vi.fn(),
      release: vi.fn(),
    };
    const secondClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      on: vi.fn(),
      release: vi.fn(),
    };
    const pool = {
      query: vi
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }),
        )
        .mockResolvedValue({ rows: [sampleRow()], rowCount: 1 }),
      connect: vi
        .fn()
        .mockResolvedValueOnce(firstClient)
        .mockResolvedValueOnce(secondClient),
    };
    const reconnectingService = new LogStreamService(pool as never);
    const callback = vi.fn();
    reconnectingService.subscribe('tenant-1', { workflowId: 'wf-1' }, callback);

    await reconnectingService.start();
    const notificationHandler = firstClient.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'notification',
    )?.[1] as ((msg: { channel: string; payload: string }) => void) | undefined;

    notificationHandler?.({
      channel: 'agirunner_execution_logs',
      payload: JSON.stringify({
        id: 1,
        tenant_id: 'tenant-1',
        source: 'runtime',
        category: 'llm',
        level: 'info',
        operation: 'llm.chat_stream',
        workflow_id: 'wf-1',
        created_at: '2026-03-09T15:30:00.000Z',
      }),
    });
    await vi.runAllTimersAsync();

    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(firstClient.release).toHaveBeenCalledTimes(1);
    expect(secondClient.query).toHaveBeenCalledWith('LISTEN agirunner_execution_logs');
    expect(callback).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
