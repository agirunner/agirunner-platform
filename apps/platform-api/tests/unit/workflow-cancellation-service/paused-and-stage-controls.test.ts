import { describe, expect, it, vi } from 'vitest';

import { identity, makeCancellationService, makeTransactionClient } from './support.js';

describe('WorkflowCancellationService paused workflow controls', () => {
  it('allows paused workflows to transition into cancellation and stop any remaining workflow-bound execution', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1', state: 'paused', metadata: { pause_requested_at: '2026-03-12T00:00:00.000Z' }, lifecycle: 'planned' }] };
      }
      if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_stage_gates')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_stages')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE tasks')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE execution_container_leases')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_activations')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflows')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE workflow_work_items')) return { rowCount: 2, rows: [] };
      if (sql.startsWith('UPDATE agents')) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = makeTransactionClient(query);
    const service = makeCancellationService({ client, eventService, getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'cancelled' })) });

    const result = await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(result).toEqual(expect.objectContaining({ id: 'workflow-1', state: 'cancelled' }));
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE workflows'), ['tenant-1', 'workflow-1', expect.objectContaining({ cancel_requested_at: expect.any(String) })]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE workflow_work_items'), ['tenant-1', 'workflow-1', expect.objectContaining({ cancel_requested_at: expect.any(String) })]);
    expect(eventService.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.cancellation_requested' }), client);
  });

  it('clears the pause marker when a paused workflow is cancelled', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1', state: 'paused', metadata: { pause_requested_at: '2026-03-12T00:00:00.000Z' }, lifecycle: 'planned' }] };
      }
      if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_stage_gates')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_stages')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE tasks')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE execution_container_leases')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_activations')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_work_items')) {
        expect(sql).toContain("COALESCE(metadata, '{}'::jsonb) - 'pause_requested_at'");
        expect(params).toEqual(['tenant-1', 'workflow-1', expect.objectContaining({ cancel_requested_at: expect.any(String) })]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith('UPDATE workflows')) {
        expect(sql).toContain("COALESCE(metadata, '{}'::jsonb) - 'pause_requested_at'");
        expect(params).toEqual(['tenant-1', 'workflow-1', expect.objectContaining({ cancel_requested_at: expect.any(String) })]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith('UPDATE agents')) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = makeTransactionClient(query);
    const service = makeCancellationService({ client, getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'cancelled' })) });

    const result = await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(result).toEqual(expect.objectContaining({ id: 'workflow-1', state: 'cancelled' }));
  });

  it('closes pending stage gates when workflow cancellation is requested', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1', state: 'active', metadata: {}, lifecycle: 'planned' }] };
      }
      if (sql.startsWith('UPDATE tasks')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_stage_gates')) return { rowCount: 2, rows: [] };
      if (sql.startsWith('UPDATE workflow_stages')) return { rowCount: 1, rows: [] };
      if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_activations')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE execution_container_leases')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_work_items')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE workflows')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE agents')) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = makeTransactionClient(query);
    const service = makeCancellationService({ client, getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'paused' })) });

    await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE workflow_stage_gates'), ['tenant-1', 'workflow-1', 'admin', 'admin']);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE workflow_stages'), ['tenant-1', 'workflow-1']);
  });

  it('marks queued workflow activations as failed when a workflow is cancelled', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1', state: 'active', metadata: {}, lifecycle: 'planned' }] };
      }
      if (sql.startsWith('UPDATE tasks')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_stage_gates')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_stages')) return { rowCount: 0, rows: [] };
      if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_activations')) {
        expect(sql).toContain("SET state = 'failed'");
        expect(sql).toContain("state IN ('queued', 'processing')");
        expect(params).toEqual(['tenant-1', 'workflow-1', 'Workflow cancelled by operator.']);
        return { rowCount: 1, rows: [{ id: 'activation-1' }] };
      }
      if (sql.startsWith('UPDATE execution_container_leases')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_work_items')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE workflows')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE agents')) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = makeTransactionClient(query);
    const service = makeCancellationService({ client, getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'cancelled' })) });

    await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("SET state = 'failed'"), ['tenant-1', 'workflow-1', 'Workflow cancelled by operator.']);
  });

  it('does not persist blocked stage status for continuous workflow cancellation', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1', state: 'active', metadata: {}, lifecycle: 'ongoing' }] };
      }
      if (sql.startsWith('UPDATE tasks')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_stage_gates')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE workflow_stages')) { expect(sql).not.toMatch(/\bstatus\s*=\s*CASE/); return { rowCount: 1, rows: [] }; }
      if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_activations')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE execution_container_leases')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_work_items')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE workflows')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE agents')) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = makeTransactionClient(query);
    const service = makeCancellationService({ client, getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'paused' })) });

    await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE workflow_stages'), ['tenant-1', 'workflow-1']);
  });
});
