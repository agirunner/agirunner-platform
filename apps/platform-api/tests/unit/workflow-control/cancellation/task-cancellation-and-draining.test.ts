import { describe, expect, it, vi } from 'vitest';

import { identity, makeCancellationService, makeTransactionClient } from './support.js';

describe('WorkflowCancellationService task cancellation and draining', () => {
  it('uses canonical in_progress task state when selecting active tasks for workflow cancellation', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1', state: 'active', metadata: {}, lifecycle: 'planned' }] };
      }
      if (sql.startsWith('UPDATE tasks')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_stage_gates')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_stages')) return { rowCount: 0, rows: [] };
      if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_activations')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE execution_container_leases')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_work_items')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE workflows')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE agents')) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = makeTransactionClient(query);
    const service = makeCancellationService({
      client,
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'paused' })),
    });

    const result = await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(result).toEqual(expect.objectContaining({ id: 'workflow-1', state: 'cancelled' }));
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("state = ANY($3::task_state[])"),
      ['tenant-1', 'workflow-1', ['claimed', 'in_progress'], null],
    );
  });

  it('cancels active workflow tasks immediately, clears ownership, releases leases, and drains specialist runtimes', async () => {
    const workerConnectionHub = { sendToWorker: vi.fn() };
    const eventService = { emit: vi.fn(async () => undefined) };
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1', state: 'active', metadata: {}, lifecycle: 'planned' }] };
      }
      if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) {
        return { rowCount: 2, rows: [
          { id: 'task-specialist-1', state: 'in_progress', assigned_worker_id: 'worker-1', is_orchestrator_task: false },
          { id: 'task-orchestrator-1', state: 'claimed', assigned_worker_id: null, is_orchestrator_task: true },
        ] };
      }
      if (sql.startsWith('INSERT INTO worker_signals')) {
        return { rowCount: 1, rows: [{ id: 'signal-1', created_at: new Date('2026-03-12T00:00:00.000Z') }] };
      }
      if (sql.startsWith('UPDATE tasks')) return { rowCount: 2, rows: [{ id: 'task-specialist-1', is_orchestrator_task: false }, { id: 'task-orchestrator-1', is_orchestrator_task: true }] };
      if (sql.startsWith('UPDATE workflow_stage_gates')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_stages')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE execution_container_leases')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE runtime_heartbeats') && sql.includes('SET task_id = NULL')) return { rowCount: 2, rows: [] };
      if (sql.startsWith('UPDATE runtime_heartbeats')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE workflow_activations')) return { rowCount: 1, rows: [{ id: 'activation-1' }] };
      if (sql.startsWith('UPDATE workflow_work_items')) return { rowCount: 2, rows: [] };
      if (sql.startsWith('UPDATE workflows')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE agents')) return { rowCount: 2, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = makeTransactionClient(query);
    const service = makeCancellationService({
      client,
      eventService,
      workerConnectionHub,
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'cancelled' })),
    });

    await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("SET state = 'cancelled'"), expect.arrayContaining(['tenant-1', 'workflow-1']));
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE execution_container_leases'), ['tenant-1', 'workflow-1']);
    const workerSignalCalls = client.query.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO worker_signals'));
    expect(workerSignalCalls).toHaveLength(1);
    expect(workerSignalCalls[0]?.[0]).toContain("'set_draining'");
    expect(workerSignalCalls[0]?.[1]).toEqual(['tenant-1', 'worker-1', { reason: 'workflow_stopped', workflow_id: 'workflow-1' }]);
    expect(workerConnectionHub.sendToWorker).toHaveBeenCalledWith('worker-1', expect.objectContaining({ task_id: null, signal_type: 'set_draining', data: { reason: 'workflow_stopped', workflow_id: 'workflow-1' } }));
    expect(eventService.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'worker.signaled', entityId: 'worker-1' }), client);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE runtime_heartbeats'), ['tenant-1', ['task-specialist-1']]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('SET task_id = NULL'), ['tenant-1', ['task-specialist-1', 'task-orchestrator-1']]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE agents'), ['tenant-1', ['task-specialist-1', 'task-orchestrator-1']]);
  });

  it('cancels escalated tasks immediately during workflow cancellation', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1', state: 'active', metadata: {}, lifecycle: 'planned' }] };
      }
      if (sql.startsWith('UPDATE tasks')) return { rowCount: 1, rows: [{ id: 'task-1' }] };
      if (sql.startsWith('UPDATE workflow_stage_gates')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_stages')) return { rowCount: 0, rows: [] };
      if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_activations')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE execution_container_leases')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_work_items')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE workflows')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE agents')) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = makeTransactionClient(query);
    const service = makeCancellationService({
      client,
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'cancelled' })),
    });

    await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("state = ANY($3::task_state[])"),
      ['tenant-1', 'workflow-1', ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'failed', 'escalated'], null],
    );
  });
});
