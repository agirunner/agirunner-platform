import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  stopWorkflowBoundExecution,
  enqueueWorkflowActivationRecord,
} = vi.hoisted(() => ({
  stopWorkflowBoundExecution: vi.fn(),
  enqueueWorkflowActivationRecord: vi.fn(),
}));

vi.mock('../../../../src/services/workflow-operations/workflow-execution-stop-service.js', () => ({
  stopWorkflowBoundExecution,
}));

vi.mock('../../../../src/services/workflow-activation/workflow-activation-record.js', () => ({
  enqueueWorkflowActivationRecord,
}));

import { WorkflowWorkItemControlService } from '../../../../src/services/workflow-control/workflow-work-item-control-service.js';

const identity = {
  id: 'admin-1',
  tenantId: 'tenant-1',
  scope: 'admin' as const,
  ownerType: 'tenant',
  ownerId: 'tenant-1',
  keyPrefix: 'admin-key',
};

describe('WorkflowWorkItemControlService', () => {
  beforeEach(() => {
    stopWorkflowBoundExecution.mockReset();
    enqueueWorkflowActivationRecord.mockReset();
  });

  it('cancels the whole workflow when the last open work item is cancelled', async () => {
    stopWorkflowBoundExecution
      .mockResolvedValueOnce({
        cancelledTaskIds: ['specialist-task-1'],
        cancelledSpecialistTaskIds: ['specialist-task-1'],
        activeTaskIds: ['specialist-task-1'],
        activeSpecialistTaskIds: ['specialist-task-1'],
        signalledTaskCount: 0,
        cancelledActivationCount: 0,
      })
      .mockResolvedValueOnce({
        cancelledTaskIds: ['orchestrator-task-1'],
        cancelledSpecialistTaskIds: [],
        activeTaskIds: ['orchestrator-task-1'],
        activeSpecialistTaskIds: [],
        signalledTaskCount: 0,
        cancelledActivationCount: 1,
      });

    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }

      if (sql.includes('FROM workflow_work_items wi') && sql.includes('FOR UPDATE OF wi, w')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'work-item-1',
            workflow_id: 'workflow-1',
            completed_at: null,
            metadata: {},
            workflow_state: 'active',
            workflow_metadata: {},
          }],
        };
      }

      if (sql.startsWith('UPDATE runtime_heartbeats') && sql.includes('SET task_id = NULL')) {
        return { rowCount: 1, rows: [] };
      }

      if (sql.startsWith('UPDATE workflow_work_items') && sql.includes('completed_at = COALESCE')) {
        expect(params?.[0]).toBe('tenant-1');
        expect(params?.[1]).toBe('workflow-1');
        expect(params?.[2]).toBe('work-item-1');
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('SELECT COUNT(*)::int AS count') && sql.includes('FROM workflow_work_items')) {
        expect(params).toEqual(['tenant-1', 'workflow-1']);
        return { rowCount: 1, rows: [{ count: 0 }] };
      }

      if (sql.startsWith('UPDATE workflows')) {
        expect(params?.[0]).toBe('tenant-1');
        expect(params?.[1]).toBe('workflow-1');
        expect((params?.[2] as Record<string, unknown>).cancel_requested_at).toEqual(expect.any(String));
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const client = {
      query,
      release: vi.fn(),
    };

    const eventService = { emit: vi.fn(async () => undefined) };
    const stateService = {
      recomputeWorkflowState: vi.fn(async () => 'cancelled'),
    };

    const service = new WorkflowWorkItemControlService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      stateService: stateService as never,
      resolveCancelSignalGracePeriodMs: async () => 60_000,
      getWorkflowWorkItem: vi.fn(async () => ({ id: 'work-item-1', workflow_id: 'workflow-1' })),
    });

    await service.cancelWorkflowWorkItem(identity as never, 'workflow-1', 'work-item-1');

    expect(stopWorkflowBoundExecution).toHaveBeenCalledTimes(2);
    expect(stopWorkflowBoundExecution).toHaveBeenNthCalledWith(
      1,
      client,
      expect.any(Object),
      expect.objectContaining({
        tenantId: 'tenant-1',
        workflowId: 'workflow-1',
        workItemId: 'work-item-1',
        disposition: 'cancel',
      }),
    );
    expect(stopWorkflowBoundExecution).toHaveBeenNthCalledWith(
      2,
      client,
      expect.any(Object),
      expect.objectContaining({
        tenantId: 'tenant-1',
        workflowId: 'workflow-1',
        disposition: 'cancel',
        signalReason: 'last_open_work_item_cancelled',
        summary: 'Workflow cancelled because the last open work item was cancelled.',
      }),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflows'),
      ['tenant-1', 'workflow-1', expect.objectContaining({ cancel_requested_at: expect.any(String) })],
    );
    expect(enqueueWorkflowActivationRecord).not.toHaveBeenCalled();
  });
});
