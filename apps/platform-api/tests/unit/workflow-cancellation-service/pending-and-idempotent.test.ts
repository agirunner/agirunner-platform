import { describe, expect, it, vi } from 'vitest';

import { makeCancellationService, makeTransactionClient, identity } from './support.js';

describe('WorkflowCancellationService cancellation state handling', () => {
  it('allows cancellation while a workflow is still pending so planned runs can be stopped before dispatch', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1', state: 'pending', metadata: {}, lifecycle: 'planned' }] };
      }
      if (sql.startsWith('UPDATE workflow_stage_gates')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE workflow_stages')) return { rowCount: 0, rows: [] };
      if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE tasks')) return { rowCount: 0, rows: [] };
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
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'cancelled' })),
    });

    const result = await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(result).toEqual(expect.objectContaining({ id: 'workflow-1', state: 'cancelled' }));
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('treats a repeated cancellation request as idempotent once cancel_requested_at is present', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            state: 'paused',
            metadata: { cancel_requested_at: '2026-03-12T00:00:00.000Z', cancel_force_at: '2026-03-12T00:01:00.000Z' },
            lifecycle: 'planned',
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = makeTransactionClient(query);
    const getWorkflow = vi.fn(async () => ({ id: 'workflow-1', state: 'paused' }));
    const eventService = { emit: vi.fn() };
    const stateService = { recomputeWorkflowState: vi.fn() };
    const service = makeCancellationService({ client, getWorkflow, eventService, stateService });

    const result = await service.cancelWorkflow(identity as never, 'workflow-1');
    const workflowSql = String(client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('FROM workflows'))?.[0] ?? '');

    expect(result).toEqual({ id: 'workflow-1', state: 'paused' });
    expect(workflowSql).toBe('SELECT id, state, metadata, lifecycle FROM workflows WHERE tenant_id = $1 AND id = $2 FOR UPDATE');
    expect(getWorkflow).toHaveBeenCalledWith('tenant-1', 'workflow-1');
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(stateService.recomputeWorkflowState).not.toHaveBeenCalled();
  });
});
