import { describe, expect, it, vi } from 'vitest';

import { resolveWorkflowOperatorExecutionContext } from '../../../src/services/workflow-operator/workflow-operator-execution-context.js';

const IDENTITY = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'user',
  ownerId: 'user-1',
  keyPrefix: 'admin',
} as const;

function createPool() {
  return {
    query: vi.fn(),
  };
}

describe('resolveWorkflowOperatorExecutionContext', () => {
  it('accepts recently settled workflow tasks as valid operator record execution context', async () => {
    const pool = createPool();
    pool.query.mockImplementationOnce(async (sql: string, params?: unknown[]) => {
      expect(sql).toContain('state = ANY');
      expect(params).toEqual([
        'tenant-1',
        'workflow-1',
        'task-1',
        [
          'claimed',
          'in_progress',
          'output_pending_assessment',
          'awaiting_approval',
          'completed',
          'failed',
          'cancelled',
          'escalated',
        ],
      ]);
      return {
        rowCount: 1,
        rows: [{
          id: 'task-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          is_orchestrator_task: false,
          role: 'Verifier',
          state: 'completed',
        }],
      };
    });

    const result = await resolveWorkflowOperatorExecutionContext(
      pool as never,
      IDENTITY as never,
      'workflow-1',
      {
        executionContextId: 'task-1',
        sourceKind: 'specialist',
        taskId: 'task-1',
        workItemId: 'work-item-1',
      },
    );

    expect(result).toEqual({
      executionContextId: 'task-1',
      sourceKind: 'specialist',
      sourceRoleName: 'Verifier',
      taskId: 'task-1',
      workItemId: 'work-item-1',
    });
  });

  it('accepts consumed workflow activations as valid operator record execution context', async () => {
    const pool = createPool();
    pool.query
      .mockImplementationOnce(async () => ({
        rowCount: 0,
        rows: [],
      }))
      .mockImplementationOnce(async (sql: string, params?: unknown[]) => {
        expect(sql).not.toContain('consumed_at IS NULL');
        expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
        return {
          rowCount: 1,
          rows: [{
            id: 'activation-row-1',
            workflow_id: 'workflow-1',
            activation_id: 'activation-1',
            state: 'completed',
            consumed_at: new Date('2026-03-28T10:00:00.000Z'),
          }],
        };
      })
      ;

    const result = await resolveWorkflowOperatorExecutionContext(
      pool as never,
      IDENTITY as never,
      'workflow-1',
      {
        executionContextId: 'activation-1',
        sourceKind: 'orchestrator',
      },
    );

    expect(result).toEqual({
      executionContextId: 'activation-1',
      sourceKind: 'orchestrator',
      sourceRoleName: 'Orchestrator',
      taskId: null,
      workItemId: null,
    });
  });
});
