import { describe, expect, it, vi } from 'vitest';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService concurrent state guard (maintenance-sad cancellation race)', () => {
  it('prevents stale transitions from overwriting newer task state', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.startsWith('UPDATE tasks SET')) {
          // Simulate optimistic-concurrency miss: row state changed after initial read.
          return { rows: [], rowCount: 0 };
        }

        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const pool = {
      connect: vi.fn(async () => client),
    };

    const loadTaskOrThrow = vi
      .fn()
      // Guard read in startTask sees claimed state (not in_progress, so continues).
      .mockResolvedValueOnce({
        id: 'task-1',
        state: 'claimed',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
      })
      // First read inside applyStateTransition sees claimed state.
      .mockResolvedValueOnce({
        id: 'task-1',
        state: 'claimed',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
      })
      // Second read after update miss sees that cancellation won the race.
      .mockResolvedValueOnce({
        id: 'task-1',
        state: 'cancelled',
        workflow_id: null,
        assigned_agent_id: null,
        assigned_worker_id: null,
      });

    const eventService = { emit: vi.fn() };
    const workflowStateService = { recomputeWorkflowState: vi.fn() };

    const service = new TaskLifecycleService({
      pool: pool as never,
      eventService: eventService as never,
      workflowStateService: workflowStateService as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow,
      toTaskResponse: (task) => task,
    });

    const identity = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent' as const,
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-key',
    };

    await expect(service.startTask(identity, 'task-1', { agent_id: 'agent-1' })).rejects.toThrow(
      /INVALID_STATE_TRANSITION|Task state changed concurrently|Cannot transition from 'cancelled' to 'in_progress'/,
    );

    const updateCall = client.query.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).startsWith('UPDATE tasks SET'),
    );

    expect(updateCall).toBeDefined();
    expect(updateCall?.[0]).toContain('state = ANY(');

    const updateParams =
      ((updateCall as unknown[] | undefined)?.[1] as unknown[] | undefined) ?? [];
    expect(updateParams[updateParams.length - 1]).toEqual(['claimed']);

    expect(eventService.emit).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
