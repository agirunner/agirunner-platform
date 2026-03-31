import { describe, expect, it, vi } from 'vitest';

import { WorkflowActivationDispatchService } from './test-harness.js';

describe('WorkflowActivationDispatchService', () => {
  it('enqueues only fresh heartbeat activations for idle workflows', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-13T12:00:00Z').getTime());
    const eventService = { emit: vi.fn(async () => undefined) };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w')) {
          expect(sql).toContain('t.is_orchestrator_task = false');
          expect(sql).toContain("AND t.state = ANY($3::task_state[])");
          expect(params).toEqual([
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment'],
            300_000,
            ['claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment'],
            2,
          ]);
          return {
            rowCount: 2,
            rows: [
              { tenant_id: 'tenant-1', workflow_id: 'workflow-1' },
              { tenant_id: 'tenant-1', workflow_id: 'workflow-2' },
            ],
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          const requestId = params?.[2];
          if (requestId === 'heartbeat:workflow-1:5911344') {
            return {
              rowCount: 1,
              rows: [{
                id: 'activation-heartbeat-1',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: null,
                request_id: requestId,
                reason: 'heartbeat',
                event_type: 'heartbeat',
                payload: {},
                state: 'queued',
                dispatch_attempt: 0,
                dispatch_token: null,
                queued_at: new Date('2026-03-13T12:00:00Z'),
                started_at: null,
                consumed_at: null,
                completed_at: null,
                summary: null,
                error: null,
              }],
            };
          }
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      connect: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: pool as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_HEARTBEAT_INTERVAL_MS: 300_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    try {
      const enqueued = await service.enqueueHeartbeatActivations(2);

      expect(enqueued).toBe(1);
      expect(eventService.emit).toHaveBeenCalledTimes(1);
      expect(eventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'workflow.activation_queued',
          entityId: 'workflow-1',
          data: expect.objectContaining({
            activation_id: 'activation-heartbeat-1',
            event_type: 'heartbeat',
            reason: 'heartbeat',
          }),
        }),
      );
    } finally {
      now.mockRestore();
    }
  });

  it('does not enqueue heartbeat candidates while specialist work is actively in flight', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w')) {
          expect(sql).toContain('t.is_orchestrator_task = false');
          expect(params).toEqual([
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment'],
            300_000,
            ['claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment'],
            5,
          ]);
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      connect: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: pool as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_HEARTBEAT_INTERVAL_MS: 300_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const enqueued = await service.enqueueHeartbeatActivations(5);

    expect(enqueued).toBe(0);
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('dispatches queued activations with a bounded workflow batch and counts only created orchestrator tasks', async () => {
    const pool = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => {
        expect(params).toEqual([
          ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment'],
          60_000,
          2,
        ]);
        return {
          rowCount: 2,
          rows: [
            { id: 'activation-1', tenant_id: 'tenant-1', workflow_id: 'workflow-1' },
            { id: 'activation-2', tenant_id: 'tenant-1', workflow_id: 'workflow-2' },
          ],
        };
      }),
      connect: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi
      .spyOn(service, 'dispatchActivation')
      .mockResolvedValueOnce('task-1')
      .mockResolvedValueOnce(null);

    const dispatched = await service.dispatchQueuedActivations(2);

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(dispatchSpy).toHaveBeenNthCalledWith(1, 'tenant-1', 'activation-1');
    expect(dispatchSpy).toHaveBeenNthCalledWith(2, 'tenant-1', 'activation-2');
    expect(dispatched).toBe(1);
  });

  it('treats task and child-workflow transitions as immediate dispatch candidates', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        expect(sql).toContain("wa.event_type = 'workflow.created'");
        expect(sql).toContain("wa.event_type = 'task.approved'");
        expect(sql).toContain("wa.event_type = 'task.handoff_submitted'");
        expect(sql).toContain("wa.event_type = 'child_workflow.completed'");
        expect(params).toEqual([
          ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment'],
          60_000,
          3,
        ]);
        return {
          rowCount: 3,
          rows: [
            { id: 'activation-approved', tenant_id: 'tenant-1', workflow_id: 'workflow-1' },
            { id: 'activation-child', tenant_id: 'tenant-1', workflow_id: 'workflow-2' },
            { id: 'activation-created', tenant_id: 'tenant-1', workflow_id: 'workflow-3' },
          ],
        };
      }),
      connect: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi
      .spyOn(service, 'dispatchActivation')
      .mockResolvedValueOnce('task-approved')
      .mockResolvedValueOnce('task-child')
      .mockResolvedValueOnce('task-created');

    const dispatched = await service.dispatchQueuedActivations(3);

    expect(dispatchSpy).toHaveBeenCalledTimes(3);
    expect(dispatched).toBe(3);
  });

  it('treats approval, assessment, and completion signals as immediate workflow wakeups', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        expect(sql).toContain("wa.event_type = 'task.completed'");
        expect(sql).toContain("wa.event_type = 'task.failed'");
        expect(sql).toContain("wa.event_type = 'task.output_pending_assessment'");
        expect(sql).toContain("wa.event_type = 'task.approved'");
        expect(sql).toContain("wa.event_type = 'task.assessment_requested_changes'");
        expect(params).toEqual([
          ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment'],
          60_000,
          1,
        ]);
        return {
          rowCount: 1,
          rows: [{ id: 'activation-approval', tenant_id: 'tenant-1', workflow_id: 'workflow-1' }],
        };
      }),
      connect: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi.spyOn(service, 'dispatchActivation').mockResolvedValueOnce('task-approval');

    const dispatched = await service.dispatchQueuedActivations(1);

    expect(dispatchSpy).toHaveBeenCalledWith('tenant-1', 'activation-approval');
    expect(dispatched).toBe(1);
  });

  it('continues dispatching later workflows when one activation hits the active-processing uniqueness guard', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rowCount: 3,
        rows: [
          { id: 'activation-1', tenant_id: 'tenant-1', workflow_id: 'workflow-1' },
          { id: 'activation-2', tenant_id: 'tenant-1', workflow_id: 'workflow-2' },
          { id: 'activation-3', tenant_id: 'tenant-1', workflow_id: 'workflow-3' },
        ],
      })),
      connect: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const duplicateError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'idx_workflow_activations_active',
    });
    const dispatchSpy = vi
      .spyOn(service, 'dispatchActivation')
      .mockRejectedValueOnce(duplicateError)
      .mockResolvedValueOnce('task-2')
      .mockResolvedValueOnce(null);

    const dispatched = await service.dispatchQueuedActivations(3);

    expect(dispatchSpy).toHaveBeenCalledTimes(3);
    expect(dispatched).toBe(1);
  });

  it('continues dispatching later workflows when one activation fails with a generic dispatch error', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rowCount: 3,
        rows: [
          { id: 'activation-1', tenant_id: 'tenant-1', workflow_id: 'workflow-1' },
          { id: 'activation-2', tenant_id: 'tenant-1', workflow_id: 'workflow-2' },
          { id: 'activation-3', tenant_id: 'tenant-1', workflow_id: 'workflow-3' },
        ],
      })),
      connect: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi
      .spyOn(service, 'dispatchActivation')
      .mockRejectedValueOnce(new Error('transient dispatch failure'))
      .mockResolvedValueOnce('task-2')
      .mockResolvedValueOnce(null);

    const dispatched = await service.dispatchQueuedActivations(3);

    expect(dispatchSpy).toHaveBeenCalledTimes(3);
    expect(dispatched).toBe(1);
  });
});
