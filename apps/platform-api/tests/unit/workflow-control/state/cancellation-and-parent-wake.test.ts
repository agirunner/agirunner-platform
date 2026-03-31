import { describe, expect, it, vi } from 'vitest';

import { WorkflowStateService } from '../../../../src/services/workflow-control/workflow-state-service.js';
import { createPool, rowSet, workflowRow } from './support.js';

describe('WorkflowStateService cancellation and child workflow wake behavior', () => {
  it('reopens completed workflows when stage-gate request changes leaves rework active', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('WHERE w.tenant_id = $1 AND w.id = $2')) {
          return workflowRow({
            state: 'completed',
            completed_at: new Date('2026-03-29T12:00:00.000Z'),
          });
        }
        if (sql.includes('SELECT w.lifecycle, p.definition')) {
          return rowSet([{ lifecycle: 'planned' }]);
        }
        if (sql.includes('SELECT status, gate_status FROM workflow_stages')) {
          return rowSet([{ status: 'active', gate_status: 'changes_requested' }]);
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return rowSet([]);
        }
        if (sql.includes('FROM workflow_work_items')) {
          return rowSet([{ total_work_item_count: 1, open_work_item_count: 1 }]);
        }
        if (sql.includes('UPDATE workflows')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'active', true, false, true]);
          return rowSet([]);
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn() };
    const service = new WorkflowStateService(pool as never, eventService as never);
    const result = await service.recomputeWorkflowState('tenant-1', 'workflow-1');
    expect(result).toBe('active');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.state_changed',
        data: { from_state: 'completed', to_state: 'active' },
      }),
      undefined,
    );
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
