import { describe, expect, it, vi } from 'vitest';

import { WorkflowStateService } from '../../../../src/services/workflow-control/workflow-state-service.js';
import { createPool, rowSet, workflowRow } from './support.js';

describe('WorkflowStateService completion and basic transitions', () => {
  it('rejects recomputation for non-playbook workflows', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'workflow-1',
            state: 'active',
            started_at: null,
            completed_at: null,
            metadata: {},
            name: 'Legacy Workflow',
            parameters: {},
            playbook_id: null,
          },
        ],
      }),
    };
    const service = new WorkflowStateService(
      pool as never,
      { emit: vi.fn() } as never,
      undefined,
      undefined,
      undefined,
    );
    await expect(service.recomputeWorkflowState('tenant-1', 'workflow-1')).rejects.toThrow(
      'only supported for playbook workflows',
    );
  });

  it('marks standard playbook workflows completed when all stages are completed', async () => {
    const pool = createPool([
      workflowRow({ state: 'active' }),
      rowSet([{ lifecycle: 'planned' }]),
      rowSet([{ status: 'completed', gate_status: 'approved' }, { status: 'completed', gate_status: 'approved' }]),
      rowSet([]),
      rowSet([{ open_work_item_count: 0 }]),
      rowSet([]),
      rowSet([{ task_count: 0, failed_task_count: 0 }]),
    ]);
    const eventService = { emit: vi.fn() };
    const service = new WorkflowStateService(pool as never, eventService as never);
    const result = await service.recomputeWorkflowState('tenant-1', 'workflow-1');
    expect(result).toBe('completed');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.state_changed',
        data: { from_state: 'active', to_state: 'completed' },
      }),
      undefined,
    );
  });

  it('returns active for standard workflows when a stage row is active even without specialist task activity', async () => {
    const pool = createPool([
      workflowRow({ state: 'pending' }),
      rowSet([{ lifecycle: 'planned' }]),
      rowSet([{ status: 'active', gate_status: 'not_requested' }, { status: 'pending', gate_status: 'not_requested' }]),
      rowSet([]),
      rowSet([{ open_work_item_count: 0 }]),
      rowSet([]),
    ]);
    const eventService = { emit: vi.fn() };
    const service = new WorkflowStateService(pool as never, eventService as never);
    const result = await service.recomputeWorkflowState('tenant-1', 'workflow-1');
    expect(result).toBe('active');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.state_changed',
        data: { from_state: 'pending', to_state: 'active' },
      }),
      undefined,
    );
    expect(
      pool.query.mock.calls
        .map((call) => String(call[0] ?? ''))
        .some((sql) => sql.includes('SELECT current_stage')),
    ).toBe(false);
  });

  it('marks planned workflows completed when all work items have completed even if stage rows are stale', async () => {
    const pool = createPool([
      workflowRow({ state: 'active' }),
      rowSet([{ lifecycle: 'planned' }]),
      rowSet([{ status: 'active', gate_status: 'not_requested' }]),
      rowSet([]),
      rowSet([{ total_work_item_count: 2, open_work_item_count: 0 }]),
      rowSet([]),
      rowSet([{ task_count: 2, failed_task_count: 0 }]),
    ]);
    const eventService = { emit: vi.fn() };
    const service = new WorkflowStateService(pool as never, eventService as never);

    const result = await service.recomputeWorkflowState('tenant-1', 'workflow-1');

    expect(result).toBe('completed');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.state_changed',
        data: { from_state: 'active', to_state: 'completed' },
      }),
      undefined,
    );
  });
});
