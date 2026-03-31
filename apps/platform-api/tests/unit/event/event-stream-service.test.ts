import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventStreamService } from '../../../src/services/event/event-stream-service.js';

function createMockPool() {
  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    on: vi.fn(),
    release: vi.fn(),
  };
  return {
    pool: {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn().mockResolvedValue(mockClient),
    },
    client: mockClient,
  };
}

function sampleEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tenant_id: 'tenant-1',
    type: 'work_item.updated',
    entity_type: 'work_item',
    entity_id: 'wi-1',
    actor_type: 'system',
    actor_id: 'orchestrator',
    data: {
      workflow_id: 'wf-1',
      work_item_id: 'wi-1',
      stage_name: 'implementation',
      activation_id: 'activation-1',
      gate_id: 'gate-1',
    },
    created_at: '2026-03-11T12:00:00.000Z',
    ...overrides,
  };
}

describe('EventStreamService', () => {
  let mockPool: ReturnType<typeof createMockPool>;
  let service: EventStreamService;

  beforeEach(() => {
    mockPool = createMockPool();
    service = new EventStreamService(mockPool.pool as never);
  });

  async function simulateNotification(event = sampleEvent()) {
    mockPool.pool.query.mockResolvedValue({ rows: [event], rowCount: 1 });
    await service.start();
    const notificationHandler = mockPool.client.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'notification',
    )?.[1] as ((msg: { payload?: string }) => void) | undefined;
    notificationHandler?.({ payload: JSON.stringify({ id: event.id }) });
    await vi.waitFor(() => {
      expect(mockPool.pool.query).toHaveBeenCalledWith('SELECT * FROM events WHERE id = $1', [event.id]);
    });
  }

  it('matches workflow event context filters carried in payload data', async () => {
    const callback = vi.fn();
    service.subscribe(
      'tenant-1',
      {
        workflowId: 'wf-1',
        workItemId: 'wi-1',
        stageName: 'implementation',
        activationId: 'activation-1',
        gateId: 'gate-1',
      },
      callback,
    );

    await simulateNotification();

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ entity_id: 'wi-1' }));
  });

  it('matches work item filters using the canonical work_item entity id fallback', async () => {
    const callback = vi.fn();
    service.subscribe('tenant-1', { workItemId: 'wi-1' }, callback);

    await simulateNotification(
      sampleEvent({
        data: {
          workflow_id: 'wf-1',
          stage_name: 'implementation',
        },
      }),
    );

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('filters out mismatched stage or activation context', async () => {
    const callback = vi.fn();
    service.subscribe(
      'tenant-1',
      { stageName: 'review', activationId: 'activation-2' },
      callback,
    );

    await simulateNotification();

    expect(callback).not.toHaveBeenCalled();
  });

  it('redacts secret-bearing event data before notifying subscribers', async () => {
    const callback = vi.fn();
    service.subscribe('tenant-1', { workflowId: 'wf-1' }, callback);

    await simulateNotification(
      sampleEvent({
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
      }),
    );

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          workflow_id: 'wf-1',
          activation_id: 'activation-1',
          api_key: 'redacted://event-secret',
          headers: {
            Authorization: 'redacted://event-secret',
          },
        },
      }),
    );
  });

  it('reconnects the listener after the database client errors', async () => {
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
    const service = new EventStreamService(pool as never);

    await service.start();
    const errorHandler = firstClient.on.mock.calls.find((call: unknown[]) => call[0] === 'error')?.[1] as
      | ((error: Error) => void)
      | undefined;

    errorHandler?.(new Error('connection lost'));
    await vi.runAllTimersAsync();

    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(firstClient.release).toHaveBeenCalledTimes(1);
    expect(secondClient.query).toHaveBeenCalledWith('LISTEN agirunner_events');
    vi.useRealTimers();
  });

  it('reconnects after fetching a notified event row fails', async () => {
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
        .mockResolvedValue({ rows: [sampleEvent()], rowCount: 1 }),
      connect: vi
        .fn()
        .mockResolvedValueOnce(firstClient)
        .mockResolvedValueOnce(secondClient),
    };
    const reconnectingService = new EventStreamService(pool as never);
    const callback = vi.fn();
    reconnectingService.subscribe('tenant-1', { workflowId: 'wf-1' }, callback);

    await reconnectingService.start();
    const notificationHandler = firstClient.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'notification',
    )?.[1] as ((msg: { payload?: string }) => void) | undefined;

    notificationHandler?.({ payload: JSON.stringify({ id: 1 }) });
    await vi.runAllTimersAsync();

    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(firstClient.release).toHaveBeenCalledTimes(1);
    expect(secondClient.query).toHaveBeenCalledWith('LISTEN agirunner_events');
    expect(callback).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
