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

  it('returns pending for continuous workflows when no active work-item or gate posture remains', async () => {
    const pool = createPool([
      workflowRow({ state: 'active' }),
      rowSet([{ lifecycle: 'ongoing' }]),
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
      'SELECT w.lifecycle, p.definition',
    );
    expect(
      pool.query.mock.calls
        .map((call) => String(call[0] ?? ''))
        .some((sql) => sql.includes('SELECT current_stage')),
    ).toBe(false);
  });

  it('returns pending for continuous workflows when current work items already sit in terminal columns', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('WHERE w.tenant_id = $1 AND w.id = $2')) {
          return workflowRow({ state: 'active' });
        }
        if ((sql.includes('SELECT w.lifecycle')) || (sql.includes('SELECT lifecycle') && sql.includes('FROM workflows'))) {
          if (sql.includes('JOIN playbooks p')) {
            return rowSet([{
              lifecycle: 'ongoing',
              definition: {
                lifecycle: 'ongoing',
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [],
                roles: [],
              },
            }]);
          }
          return rowSet([{ lifecycle: 'ongoing' }]);
        }
        if (sql.includes('SELECT status, gate_status FROM workflow_stages')) {
          return rowSet([]);
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return rowSet([]);
        }
        if (sql.includes('FROM workflow_work_items')) {
          if (sql.includes('column_id') && sql.includes('ANY')) {
            expect(params).toEqual(['tenant-1', 'workflow-1', ['done']]);
            return rowSet([{ total_work_item_count: 2, open_work_item_count: 0 }]);
          }
          return rowSet([{ total_work_item_count: 2, open_work_item_count: 2 }]);
        }
        if (sql.includes('UPDATE workflows')) {
          return rowSet([]);
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
    };
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
  });

  it('returns active for continuous workflows when a stage gate is awaiting approval', async () => {
    const pool = createPool([
      workflowRow({ state: 'pending' }),
      rowSet([{ lifecycle: 'ongoing' }]),
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
      rowSet([{ lifecycle: 'ongoing' }]),
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

  it('preserves orchestrator ownership on workflow lifecycle events and logs for agent-scoped callers', async () => {
    const pool = createPool([
      workflowRow({ state: 'pending' }),
      rowSet([{ lifecycle: 'ongoing' }]),
      rowSet([]),
      rowSet([{ exists: 1 }]),
      rowSet([{ open_work_item_count: 0 }]),
      rowSet([]),
    ]);
    const eventService = { emit: vi.fn() };
    const logService = { insert: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkflowStateService(
      pool as never,
      eventService as never,
      undefined,
      undefined,
      logService as never,
    );

    const result = await service.recomputeWorkflowState('tenant-1', 'workflow-1', undefined, {
      actorType: 'agent',
      actorId: 'agent-1',
    });

    expect(result).toBe('active');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.state_changed',
        actorType: 'agent',
        actorId: 'agent-1',
        data: {
          from_state: 'pending',
          to_state: 'active',
          role: 'orchestrator',
          is_orchestrator_task: true,
        },
      }),
      undefined,
    );
    await vi.waitFor(() =>
      expect(logService.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'task_lifecycle',
          operation: 'task_lifecycle.workflow.state_changed',
          actorType: 'agent',
          actorId: 'agent-1',
          role: 'orchestrator',
          isOrchestratorTask: true,
        }),
      ),
    );
  });

  it('returns pending for continuous workflows when only a stale stage status remains', async () => {
    const pool = createPool([
      workflowRow({ state: 'active' }),
      rowSet([{ lifecycle: 'ongoing' }]),
      rowSet([{ status: 'active', gate_status: 'not_requested' }]),
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

  it('returns cancelled immediately during cancellation even when work items remain open', async () => {
    const pool = createPool([
      workflowRow({
        state: 'active',
        metadata: { cancel_requested_at: '2026-03-11T00:00:00.000Z' },
      }),
      rowSet([{ lifecycle: 'planned' }]),
      rowSet([{ status: 'pending', gate_status: 'not_requested' }]),
      rowSet([]),
      rowSet([{ open_work_item_count: 2 }]),
      rowSet([]),
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

  it('returns cancelled during cancellation when no active posture remains', async () => {
    const pool = createPool([
      workflowRow({
        state: 'active',
        metadata: { cancel_requested_at: '2026-03-11T00:00:00.000Z' },
      }),
      rowSet([{ lifecycle: 'planned' }]),
      rowSet([{ status: 'pending', gate_status: 'not_requested' }]),
      rowSet([]),
      rowSet([{ open_work_item_count: 0 }]),
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
      rowSet([{ lifecycle: 'planned' }]),
      rowSet([{ status: 'active', gate_status: 'not_requested' }]),
      rowSet([]),
      rowSet([{ open_work_item_count: 0 }]),
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
      rowSet([{ lifecycle: 'planned' }]),
      rowSet([{ status: 'completed', gate_status: 'approved' }, { status: 'completed', gate_status: 'approved' }]),
      rowSet([]),
      rowSet([{ open_work_item_count: 0 }]),
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
      8,
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
