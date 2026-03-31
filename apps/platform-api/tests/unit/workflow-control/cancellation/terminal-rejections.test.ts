import { describe, expect, it, vi } from 'vitest';

import { identity, makeCancellationService, makeTransactionClient } from './support.js';

describe('WorkflowCancellationService terminal cancellation rules', () => {
  it('still rejects cancellation for terminal workflows', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1', state: 'cancelled', metadata: {}, lifecycle: 'planned' }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = makeTransactionClient(query);
    const service = makeCancellationService({
      client,
      getWorkflow: vi.fn(),
      stateService: { recomputeWorkflowState: vi.fn() } as never,
    });

    await expect(service.cancelWorkflow(identity as never, 'workflow-1')).rejects.toThrow('Workflow is already terminal');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
