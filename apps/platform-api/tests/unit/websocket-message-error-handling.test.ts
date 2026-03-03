import { describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '../../src/errors/domain-errors.js';
import { handleWorkerWebsocketMessageError } from '../../src/bootstrap/websocket.js';

describe('handleWorkerWebsocketMessageError', () => {
  it('closes websocket + unregisters worker on NotFoundError heartbeat', () => {
    const unregisterWorker = vi.fn();
    const info = vi.fn();
    const warn = vi.fn();
    const close = vi.fn();

    const app = {
      log: { info, warn },
      workerConnectionHub: { unregisterWorker },
    } as unknown as Parameters<typeof handleWorkerWebsocketMessageError>[0];

    handleWorkerWebsocketMessageError(
      app,
      { tenantId: 'tenant-1' } as Parameters<typeof handleWorkerWebsocketMessageError>[1],
      'worker-1',
      'worker.heartbeat',
      new NotFoundError('Worker not found'),
      { close },
    );

    expect(unregisterWorker).toHaveBeenCalledWith('worker-1');
    expect(close).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs warning for non-NotFound errors without closing websocket', () => {
    const unregisterWorker = vi.fn();
    const info = vi.fn();
    const warn = vi.fn();
    const close = vi.fn();

    const app = {
      log: { info, warn },
      workerConnectionHub: { unregisterWorker },
    } as unknown as Parameters<typeof handleWorkerWebsocketMessageError>[0];

    handleWorkerWebsocketMessageError(
      app,
      { tenantId: 'tenant-1' } as Parameters<typeof handleWorkerWebsocketMessageError>[1],
      'worker-1',
      'signal.ack',
      new Error('boom'),
      { close },
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(unregisterWorker).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });
});
