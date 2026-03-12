import { describe, expect, it, vi } from 'vitest';

import { WorkflowBudgetService } from '../../src/services/workflow-budget-service.js';

describe('WorkflowBudgetService', () => {
  it('builds the workflow budget snapshot from workflow, metering, task, and activation state', async () => {
    const service = new WorkflowBudgetService(
      {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              token_budget: 5000,
              cost_cap_usd: '25.5000',
              max_duration_minutes: 120,
              created_at: new Date('2026-03-12T00:00:00.000Z'),
              started_at: new Date('2026-03-12T00:10:00.000Z'),
              orchestration_state: {},
            }],
          })
          .mockResolvedValueOnce({
            rowCount: 1,
            rows: [{ total_tokens_input: '700', total_tokens_output: '500', total_cost_usd: '1.2500' }],
          })
          .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: '4' }] })
          .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: '2' }] }),
      } as never,
      { emit: vi.fn(async () => undefined) } as never,
      { WORKFLOW_BUDGET_WARNING_RATIO: 0.8 },
    );

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-03-12T00:40:00.000Z').valueOf(),
    );

    const snapshot = await service.getBudgetSnapshot('tenant-1', 'workflow-1');

    expect(snapshot).toEqual({
      tokens_used: 1200,
      tokens_limit: 5000,
      cost_usd: 1.25,
      cost_limit_usd: 25.5,
      elapsed_minutes: 30,
      duration_limit_minutes: 120,
      task_count: 4,
      orchestrator_activations: 2,
      tokens_remaining: 3800,
      cost_remaining_usd: 24.25,
      time_remaining_minutes: 90,
      warning_dimensions: [],
      exceeded_dimensions: [],
      warning_threshold_ratio: 0.8,
    });
    nowSpy.mockRestore();
  });

  it('emits exceeded events and activation wakeups when a workflow crosses budget limits', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            token_budget: 1000,
            cost_cap_usd: '5.0000',
            max_duration_minutes: 60,
            created_at: new Date('2026-03-12T00:00:00.000Z'),
            started_at: new Date('2026-03-12T00:00:00.000Z'),
            orchestration_state: {},
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ total_tokens_input: '900', total_tokens_output: '250', total_cost_usd: '6.1000' }],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: '3' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }),
      release: vi.fn(),
    };
    const emit = vi.fn(async () => undefined);
    const enqueueForWorkflow = vi.fn(async () => ({ id: 'activation-1' }));
    const dispatchActivation = vi.fn(async () => 'task-1');
    const service = new WorkflowBudgetService(
      {
        connect: vi.fn(async () => client),
      } as never,
      { emit } as never,
      { WORKFLOW_BUDGET_WARNING_RATIO: 0.8 },
      { enqueueForWorkflow } as never,
      { dispatchActivation } as never,
    );

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-03-12T01:15:00.000Z').valueOf(),
    );

    const evaluation = await service.evaluatePolicy('tenant-1', 'workflow-1');

    expect(evaluation.snapshot.exceeded_dimensions).toEqual(['tokens', 'cost', 'duration']);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'budget.exceeded',
        entityId: 'workflow-1',
      }),
      client,
    );
    expect(enqueueForWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        workflowId: 'workflow-1',
        reason: 'budget.exceeded',
      }),
      client,
    );
    expect(dispatchActivation).toHaveBeenCalledWith('tenant-1', 'activation-1', client, {
      ignoreDelay: true,
    });
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    nowSpy.mockRestore();
  });
});
