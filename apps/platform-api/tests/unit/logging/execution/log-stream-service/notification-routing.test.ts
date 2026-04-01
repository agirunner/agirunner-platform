import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LogStreamService } from '../../../../../src/logging/execution/log-stream-service.js';
import { createMockPool, sampleRow } from './support.js';

describe('LogStreamService notification routing', () => {
  let mockPool: ReturnType<typeof createMockPool>;
  let service: LogStreamService;

  beforeEach(() => {
    mockPool = createMockPool();
    service = new LogStreamService(mockPool.pool as never);
  });

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

  it('returnsUnsubscribeFunction', async () => {
    await service.start();
    const callback = vi.fn();
    const unsubscribe = service.subscribe('tenant-1', {}, callback);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

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

    await new Promise((r) => setTimeout(r, 10));
    expect(callback).not.toHaveBeenCalled();
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
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ workflow_name: 'Test Workflow' }));
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
