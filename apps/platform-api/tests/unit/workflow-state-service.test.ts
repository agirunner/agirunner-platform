import { describe, expect, it, vi } from 'vitest';

import { WorkflowStateService } from '../../src/services/workflow-state-service.js';

describe('WorkflowStateService', () => {
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
      rowSet([{ lifecycle: 'standard' }]),
      rowSet([{ status: 'completed', gate_status: 'approved' }, { status: 'completed', gate_status: 'approved' }]),
      rowSet([]),
      rowSet([{ open_work_item_count: 0 }]),
      rowSet([{ current_stage: null }]),
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

  it('returns active for standard workflows when the current stage is active even without specialist task activity', async () => {
    const pool = createPool([
      workflowRow({ state: 'pending' }),
      rowSet([{ lifecycle: 'standard' }]),
      rowSet([{ status: 'pending', gate_status: 'not_requested' }, { status: 'pending', gate_status: 'not_requested' }]),
      rowSet([]),
      rowSet([{ open_work_item_count: 0 }]),
      rowSet([{ current_stage: 'implementation' }]),
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
  });

  it('returns pending for continuous workflows when no active work-item or gate posture remains', async () => {
    const pool = createPool([
      workflowRow({ state: 'active' }),
      rowSet([{ lifecycle: 'continuous' }]),
      rowSet([{ status: 'completed', gate_status: 'approved' }]),
      rowSet([]),
      rowSet([{ open_work_item_count: 0 }]),
      rowSet([]),
    ]);
    const eventService = { emit: vi.fn() };
    const service = new WorkflowStateService(pool as never, eventService as never);
    const result = await service.recomputeWorkflowState('tenant-1', 'workflow-1');
    expect(result).toBe('pending');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.state_changed',
        data: { from_state: 'active', to_state: 'pending' },
      }),
      undefined,
    );
    expect(String(pool.query.mock.calls[1]?.[0] ?? '').replace(/\s+/g, ' ')).toContain(
      'SELECT lifecycle',
    );
    expect(
      pool.query.mock.calls
        .map((call) => String(call[0] ?? ''))
        .some((sql) => sql.includes('SELECT current_stage')),
    ).toBe(false);
  });

  it('returns active for continuous workflows when a stage gate is awaiting approval', async () => {
    const pool = createPool([
      workflowRow({ state: 'pending' }),
      rowSet([{ lifecycle: 'continuous' }]),
      rowSet([{ status: 'pending', gate_status: 'awaiting_approval' }]),
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
  });

  it('returns active for continuous workflows when an orchestrator task is already in progress', async () => {
    const pool = createPool([
      workflowRow({ state: 'pending' }),
      rowSet([{ lifecycle: 'continuous' }]),
      rowSet([]),
      rowSet([{ exists: 1 }]),
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
  });

  it('keeps workflows paused while the pause marker remains even if work-item posture is still active', async () => {
    const pool = createPool([
      workflowRow({
        state: 'paused',
        metadata: { pause_requested_at: '2026-03-11T00:00:00.000Z' },
      }),
      rowSet([]),
    ]);
    const eventService = { emit: vi.fn() };
    const service = new WorkflowStateService(pool as never, eventService as never);
    const result = await service.recomputeWorkflowState('tenant-1', 'workflow-1');
    expect(result).toBe('paused');
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('does not reopen completed workflows when later task lifecycle callbacks recompute state', async () => {
    const pool = createPool([
      workflowRow({ state: 'completed' }),
      rowSet([]),
    ]);
    const eventService = { emit: vi.fn() };
    const service = new WorkflowStateService(pool as never, eventService as never);
    const result = await service.recomputeWorkflowState('tenant-1', 'workflow-1');
    expect(result).toBe('completed');
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('returns paused during cancellation when work items remain open', async () => {
    const pool = createPool([
      workflowRow({
        state: 'active',
        metadata: { cancel_requested_at: '2026-03-11T00:00:00.000Z' },
      }),
      rowSet([{ lifecycle: 'standard' }]),
      rowSet([{ status: 'pending', gate_status: 'not_requested' }]),
      rowSet([]),
      rowSet([{ open_work_item_count: 2 }]),
      rowSet([{ current_stage: null }]),
      rowSet([]),
    ]);
    const eventService = { emit: vi.fn() };
    const service = new WorkflowStateService(pool as never, eventService as never);
    const result = await service.recomputeWorkflowState('tenant-1', 'workflow-1');
    expect(result).toBe('paused');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.state_changed',
        data: { from_state: 'active', to_state: 'paused' },
      }),
      undefined,
    );
  });

  it('returns cancelled during cancellation when no active posture remains', async () => {
    const pool = createPool([
      workflowRow({
        state: 'active',
        metadata: { cancel_requested_at: '2026-03-11T00:00:00.000Z' },
      }),
      rowSet([{ lifecycle: 'standard' }]),
      rowSet([{ status: 'pending', gate_status: 'not_requested' }]),
      rowSet([]),
      rowSet([{ open_work_item_count: 0 }]),
      rowSet([{ current_stage: null }]),
      rowSet([]),
      rowSet([{ task_count: 3, failed_task_count: 1 }]),
    ]);
    const eventService = { emit: vi.fn() };
    const service = new WorkflowStateService(pool as never, eventService as never);
    const result = await service.recomputeWorkflowState('tenant-1', 'workflow-1');
    expect(result).toBe('cancelled');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.state_changed',
        data: { from_state: 'active', to_state: 'cancelled' },
      }),
      undefined,
    );
  });

  it('returns cancelled during cancellation when only a stage marker remains but no work is left to drain', async () => {
    const pool = createPool([
      workflowRow({
        state: 'active',
        metadata: { cancel_requested_at: '2026-03-11T00:00:00.000Z' },
      }),
      rowSet([{ lifecycle: 'standard' }]),
      rowSet([{ status: 'active', gate_status: 'not_requested' }]),
      rowSet([]),
      rowSet([{ open_work_item_count: 0 }]),
      rowSet([{ current_stage: 'requirements' }]),
      rowSet([]),
      rowSet([{ task_count: 0, failed_task_count: 0 }]),
    ]);
    const eventService = { emit: vi.fn() };
    const service = new WorkflowStateService(pool as never, eventService as never);
    const result = await service.recomputeWorkflowState('tenant-1', 'workflow-1');
    expect(result).toBe('cancelled');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.state_changed',
        data: { from_state: 'active', to_state: 'cancelled' },
      }),
      undefined,
    );
  });

  it('wakes the parent workflow with an explicit child outcome payload on terminal child completion', async () => {
    const pool = createPool([
      workflowRow({
        id: 'workflow-child',
        state: 'active',
        metadata: {
          parent_workflow_id: 'workflow-parent',
          parent_orchestrator_task_id: 'task-orch-1',
          parent_orchestrator_activation_id: 'activation-1',
          parent_work_item_id: 'wi-1',
          parent_stage_name: 'implementation',
        },
        name: 'Child Workflow',
        playbook_id: 'playbook-child',
      }),
      rowSet([{ lifecycle: 'standard' }]),
      rowSet([{ status: 'completed', gate_status: 'approved' }, { status: 'completed', gate_status: 'approved' }]),
      rowSet([]),
      rowSet([{ open_work_item_count: 0 }]),
      rowSet([{ current_stage: null }]),
      rowSet([]),
      rowSet([{ task_count: 4, failed_task_count: 1 }]),
      rowSet([
        {
          id: 'activation-1',
          workflow_id: 'workflow-parent',
          activation_id: null,
          request_id: 'child-workflow:workflow-child:completed',
          reason: 'child_workflow.completed',
          event_type: 'child_workflow.completed',
          payload: {},
          state: 'queued',
          queued_at: new Date('2026-03-11T00:00:00Z'),
          started_at: null,
          consumed_at: null,
          completed_at: null,
          summary: null,
          error: null,
        },
      ]),
    ]);
    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new WorkflowStateService(pool as never, eventService as never);
    const result = await service.recomputeWorkflowState('tenant-1', 'workflow-child');
    expect(result).toBe('completed');
    expect(pool.query).toHaveBeenNthCalledWith(
      9,
      expect.stringContaining('INSERT INTO workflow_activations'),
      [
        'tenant-1',
        'workflow-parent',
        'child-workflow:workflow-child:completed',
        'child_workflow.completed',
        'child_workflow.completed',
        {
          child_workflow_id: 'workflow-child',
          child_workflow_name: 'Child Workflow',
          child_workflow_state: 'completed',
          child_playbook_id: 'playbook-child',
          parent_workflow_id: 'workflow-parent',
          parent_orchestrator_task_id: 'task-orch-1',
          parent_orchestrator_activation_id: 'activation-1',
          parent_work_item_id: 'wi-1',
          parent_stage_name: 'implementation',
          outcome: {
            state: 'completed',
            task_count: 4,
            failed_task_count: 1,
          },
        },
      ],
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_queued',
        entityId: 'workflow-parent',
        data: expect.objectContaining({
          activation_id: 'activation-1',
          event_type: 'child_workflow.completed',
          reason: 'child_workflow.completed',
        }),
      }),
      undefined,
    );
  });
});

function createPool(responses: Array<{ rowCount: number; rows: unknown[] }>) {
  return {
    query: vi.fn().mockImplementation(async () => {
      if (responses.length === 0) throw new Error('Unexpected query');
      return responses.shift();
    }),
  };
}

function rowSet(rows: unknown[]) {
  return { rowCount: rows.length, rows };
}

function workflowRow(overrides: Record<string, unknown>) {
  return rowSet([
    {
      id: 'workflow-1',
      state: 'active',
      started_at: null,
      completed_at: null,
      metadata: {},
      name: 'Playbook Workflow',
      parameters: {},
      playbook_id: 'playbook-1',
      ...overrides,
    },
  ]);
}
