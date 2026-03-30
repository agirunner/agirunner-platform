import { describe, expect, it, vi, beforeEach } from 'vitest';

import { LogStreamService } from '../../src/logging/log-stream-service.js';

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

function sampleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    tenant_id: 'tenant-1',
    trace_id: 'trace-1',
    span_id: 'span-1',
    parent_span_id: null,
    source: 'runtime',
    category: 'llm',
    level: 'info',
    operation: 'llm.chat_stream',
    status: 'completed',
    duration_ms: 1200,
    payload: {},
    error: null,
    workspace_id: null,
    workflow_id: 'wf-1',
    workflow_name: 'Test Workflow',
    workspace_name: 'Test Workspace',
    task_id: 'task-1',
    work_item_id: 'work-item-1',
    stage_name: 'implementation',
    activation_id: 'activation-1',
    is_orchestrator_task: true,
    execution_backend: 'runtime_only',
    tool_owner: 'runtime',
    task_title: 'Implement feature',
    role: 'developer',
    actor_type: 'worker',
    actor_id: 'w-1',
    actor_name: 'worker-01',
    resource_type: null,
    resource_id: null,
    resource_name: null,
    created_at: '2026-03-09T15:30:00.000Z',
    ...overrides,
  };
}

describe('LogStreamService', () => {
  let mockPool: ReturnType<typeof createMockPool>;
  let service: LogStreamService;

  beforeEach(() => {
    mockPool = createMockPool();
    service = new LogStreamService(mockPool.pool as never);
  });

  describe('start/stop', () => {
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

  describe('subscribe', () => {
    it('returnsUnsubscribeFunction', async () => {
      await service.start();
      const callback = vi.fn();
      const unsubscribe = service.subscribe('tenant-1', {}, callback);
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });
  });

  describe('notification dispatch', () => {
    async function simulateNotification(payload: string) {
      await service.start();
      const notificationHandler = mockPool.client.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'notification',
      )![1] as (msg: { channel: string; payload: string }) => void;
      notificationHandler({ channel: 'agirunner_execution_logs', payload });
      await vi.waitFor(() => {
        expect(mockPool.pool.query).toHaveBeenCalled();
      });
    }

    it('dispatchesToMatchingSubscriber', async () => {
      const callback = vi.fn();
      const row = sampleRow();
      mockPool.pool.query.mockResolvedValue({ rows: [row], rowCount: 1 });

      service.subscribe('tenant-1', {}, callback);
      await simulateNotification(
        JSON.stringify({
          id: 1,
          tenant_id: 'tenant-1',
          source: 'runtime',
          category: 'llm',
          level: 'info',
          operation: 'llm.chat_stream',
          workspace_id: null,
          workflow_id: 'wf-1',
          task_id: 'task-1',
          work_item_id: 'work-item-1',
          stage_name: 'implementation',
          activation_id: 'activation-1',
          is_orchestrator_task: true,
          execution_backend: 'runtime_only',
          tool_owner: 'runtime',
          created_at: '2026-03-09T15:30:00.000Z',
        }),
      );

      expect(callback).toHaveBeenCalledWith(row);
      const [sql, params] = mockPool.pool.query.mock.calls[0];
      expect(sql).toContain('WHERE id = $1 AND created_at = $2');
      expect(params).toEqual([1, '2026-03-09T15:30:00.000Z']);
    });

    it('filtersByExecutionBackendAndToolOwner', async () => {
      const callback = vi.fn();
      mockPool.pool.query.mockResolvedValue({ rows: [sampleRow()], rowCount: 1 });

      service.subscribe(
        'tenant-1',
        { executionBackend: ['runtime_plus_task'], toolOwner: ['task'] },
        callback,
      );
      await service.start();

      const notificationHandler = mockPool.client.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'notification',
      )![1] as (msg: { channel: string; payload: string }) => void;

      notificationHandler({
        channel: 'agirunner_execution_logs',
        payload: JSON.stringify({
          id: 1,
          tenant_id: 'tenant-1',
          source: 'runtime',
          category: 'tool',
          level: 'info',
          operation: 'tool.execute',
          execution_backend: 'runtime_only',
          tool_owner: 'runtime',
          created_at: '2026-03-09T15:30:00.000Z',
        }),
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(callback).not.toHaveBeenCalled();
      expect(mockPool.pool.query).not.toHaveBeenCalled();
    });

    it('filtersOutNonMatchingTenant', async () => {
      const callback = vi.fn();
      mockPool.pool.query.mockResolvedValue({ rows: [sampleRow()], rowCount: 1 });

      service.subscribe('tenant-2', {}, callback);
      await service.start();

      const notificationHandler = mockPool.client.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'notification',
      )![1] as (msg: { channel: string; payload: string }) => void;

      notificationHandler({
        channel: 'agirunner_execution_logs',
        payload: JSON.stringify({
          id: 1,
          tenant_id: 'tenant-1',
          source: 'runtime',
          category: 'llm',
          level: 'info',
          operation: 'llm.chat_stream',
          created_at: '2026-03-09T15:30:00.000Z',
        }),
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(callback).not.toHaveBeenCalled();
    });

    it('filtersByCategory', async () => {
      const callback = vi.fn();
      mockPool.pool.query.mockResolvedValue({ rows: [sampleRow()], rowCount: 1 });

      service.subscribe('tenant-1', { category: ['tool'] }, callback);
      await service.start();

      const notificationHandler = mockPool.client.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'notification',
      )![1] as (msg: { channel: string; payload: string }) => void;

      notificationHandler({
        channel: 'agirunner_execution_logs',
        payload: JSON.stringify({
          id: 1,
          tenant_id: 'tenant-1',
          source: 'runtime',
          category: 'llm',
          level: 'info',
          operation: 'llm.chat_stream',
          created_at: '2026-03-09T15:30:00.000Z',
        }),
      });

      // No subscribers match — pool.query should NOT be called for the full row fetch
      await new Promise((r) => setTimeout(r, 10));
      expect(callback).not.toHaveBeenCalled();
      // Only the LISTEN query was called, no row fetch
      expect(mockPool.pool.query).not.toHaveBeenCalled();
    });

    it('filtersByMinimumLevel', async () => {
      const callback = vi.fn();
      mockPool.pool.query.mockResolvedValue({ rows: [sampleRow()], rowCount: 1 });

      service.subscribe('tenant-1', { level: 'warn' }, callback);
      await service.start();

      const notificationHandler = mockPool.client.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'notification',
      )![1] as (msg: { channel: string; payload: string }) => void;

      notificationHandler({
        channel: 'agirunner_execution_logs',
        payload: JSON.stringify({
          id: 1,
          tenant_id: 'tenant-1',
          source: 'runtime',
          category: 'llm',
          level: 'info',
          operation: 'llm.chat_stream',
          created_at: '2026-03-09T15:30:00.000Z',
        }),
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(callback).not.toHaveBeenCalled();
    });

    it('filtersByWorkflowId', async () => {
      const callback = vi.fn();
      mockPool.pool.query.mockResolvedValue({ rows: [sampleRow()], rowCount: 1 });

      service.subscribe('tenant-1', { workflowId: 'wf-other' }, callback);
      await service.start();

      const notificationHandler = mockPool.client.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'notification',
      )![1] as (msg: { channel: string; payload: string }) => void;

      notificationHandler({
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

      await new Promise((r) => setTimeout(r, 10));
      expect(callback).not.toHaveBeenCalled();
    });

    it('filtersByWorkItemAndOrchestratorFlag', async () => {
      const callback = vi.fn();
      mockPool.pool.query.mockResolvedValue({ rows: [sampleRow()], rowCount: 1 });

      service.subscribe(
        'tenant-1',
        { workItemId: 'work-item-2', isOrchestratorTask: true },
        callback,
      );
      await service.start();

      const notificationHandler = mockPool.client.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'notification',
      )![1] as (msg: { channel: string; payload: string }) => void;

      notificationHandler({
        channel: 'agirunner_execution_logs',
        payload: JSON.stringify({
          id: 1,
          tenant_id: 'tenant-1',
          source: 'runtime',
          category: 'llm',
          level: 'info',
          operation: 'llm.chat_stream',
          work_item_id: 'work-item-1',
          is_orchestrator_task: true,
          created_at: '2026-03-09T15:30:00.000Z',
        }),
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(callback).not.toHaveBeenCalled();
      expect(mockPool.pool.query).not.toHaveBeenCalled();
    });

    it('includesWorkflowNameInFetchedRow', async () => {
      const callback = vi.fn();
      const row = sampleRow();
      mockPool.pool.query.mockResolvedValue({ rows: [row], rowCount: 1 });

      service.subscribe('tenant-1', {}, callback);
      await simulateNotification(
        JSON.stringify({
          id: 1,
          tenant_id: 'tenant-1',
          source: 'runtime',
          category: 'llm',
          level: 'info',
          operation: 'llm.chat_stream',
          created_at: '2026-03-09T15:30:00.000Z',
        }),
      );

      const [sql] = mockPool.pool.query.mock.calls[0];
      expect(sql).toContain('workflow_name');
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ workflow_name: 'Test Workflow' }),
      );
    });

    it('fansOutToMultipleMatchingSubscribers', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const row = sampleRow();
      mockPool.pool.query.mockResolvedValue({ rows: [row], rowCount: 1 });

      service.subscribe('tenant-1', {}, callback1);
      service.subscribe('tenant-1', {}, callback2);
      await simulateNotification(
        JSON.stringify({
          id: 1,
          tenant_id: 'tenant-1',
          source: 'runtime',
          category: 'llm',
          level: 'info',
          operation: 'llm.chat_stream',
          created_at: '2026-03-09T15:30:00.000Z',
        }),
      );

      expect(callback1).toHaveBeenCalledWith(row);
      expect(callback2).toHaveBeenCalledWith(row);
    });

    it('filtersByTraceId', async () => {
      const callback = vi.fn();
      mockPool.pool.query.mockResolvedValue({ rows: [sampleRow()], rowCount: 1 });

      service.subscribe('tenant-1', { traceId: 'trace-other' }, callback);
      await service.start();

      const notificationHandler = mockPool.client.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'notification',
      )![1] as (msg: { channel: string; payload: string }) => void;

      notificationHandler({
        channel: 'agirunner_execution_logs',
        payload: JSON.stringify({
          id: 1,
          tenant_id: 'tenant-1',
          trace_id: 'trace-1',
          source: 'runtime',
          category: 'llm',
          level: 'info',
          operation: 'llm.chat_stream',
          created_at: '2026-03-09T15:30:00.000Z',
        }),
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(callback).not.toHaveBeenCalled();
    });

    it('filtersByOperationPrefix', async () => {
      const callback = vi.fn();
      mockPool.pool.query.mockResolvedValue({ rows: [sampleRow()], rowCount: 1 });

      service.subscribe('tenant-1', { operation: ['tool.*'] }, callback);
      await service.start();

      const notificationHandler = mockPool.client.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'notification',
      )![1] as (msg: { channel: string; payload: string }) => void;

      notificationHandler({
        channel: 'agirunner_execution_logs',
        payload: JSON.stringify({
          id: 1,
          tenant_id: 'tenant-1',
          source: 'runtime',
          category: 'llm',
          level: 'info',
          operation: 'llm.chat_stream',
          created_at: '2026-03-09T15:30:00.000Z',
        }),
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(callback).not.toHaveBeenCalled();
      expect(mockPool.pool.query).not.toHaveBeenCalled();
    });

    it('matchesOperationPrefix', async () => {
      const callback = vi.fn();
      const row = sampleRow();
      mockPool.pool.query.mockResolvedValue({ rows: [row], rowCount: 1 });

      service.subscribe('tenant-1', { operation: ['llm.*'] }, callback);
      await simulateNotification(
        JSON.stringify({
          id: 1,
          tenant_id: 'tenant-1',
          source: 'runtime',
          category: 'llm',
          level: 'info',
          operation: 'llm.chat_stream',
          created_at: '2026-03-09T15:30:00.000Z',
        }),
      );

      expect(callback).toHaveBeenCalledWith(row);
    });

    it('ignoresInvalidJsonPayload', async () => {
      await service.start();
      const notificationHandler = mockPool.client.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'notification',
      )![1] as (msg: { channel: string; payload: string }) => void;

      notificationHandler({
        channel: 'agirunner_execution_logs',
        payload: 'not-json',
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(mockPool.pool.query).not.toHaveBeenCalled();
    });

    it('ignoresWrongChannel', async () => {
      const callback = vi.fn();
      service.subscribe('tenant-1', {}, callback);
      await service.start();

      const notificationHandler = mockPool.client.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'notification',
      )![1] as (msg: { channel: string; payload?: string }) => void;

      notificationHandler({ channel: 'other_channel', payload: '{"id":1}' });
      await new Promise((r) => setTimeout(r, 10));
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
