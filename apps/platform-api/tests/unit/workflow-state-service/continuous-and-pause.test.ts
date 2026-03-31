import { describe, expect, it, vi } from 'vitest';

import { WorkflowStateService } from '../../../src/services/workflow-state-service.js';
import { createPool, rowSet, workflowRow } from './support.js';

describe('WorkflowStateService continuous and pause behavior', () => {
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
});
