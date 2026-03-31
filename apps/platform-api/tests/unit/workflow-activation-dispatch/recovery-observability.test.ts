import { describe, expect, it, vi } from 'vitest';

import { WorkflowActivationDispatchService } from './test-harness.js';

describe('WorkflowActivationDispatchService', () => {
  it('records stale orchestrator detections without requeueing when the task is still active', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations wa') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-8',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-7',
              activation_id: 'activation-8',
              request_id: 'req-8',
              reason: 'stage.changed',
              event_type: 'stage.changed',
              payload: { stage_name: 'review' },
              state: 'processing',
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: new Date('2026-03-11T00:02:00Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
              active_task_id: 'task-active',
            }],
          };
        }
        if (sql.includes('SET summary = COALESCE(summary, \'Stale orchestrator detected during activation recovery\'')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-7',
            'activation-8',
            '2026-03-11T00:02:00.000Z',
            300000,
            'task-active',
          ]);
          return { rowCount: 2, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new WorkflowActivationDispatchService({
      pool: {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (sql.includes('SELECT wa.id, wa.tenant_id')) {
            expect(params).toEqual([
              300_000,
              20,
              ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment'],
            ]);
            return { rowCount: 1, rows: [{ id: 'activation-8', tenant_id: 'tenant-1' }] };
          }
          throw new Error(`unexpected pool query: ${sql}`);
        }),
        connect: vi.fn(async () => client),
      } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 10_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const recovery = await service.recoverStaleActivations();

    expect(recovery).toEqual({
      requeued: 0,
      redispatched: 0,
      reported: 1,
      details: [
        expect.objectContaining({
          activation_id: 'activation-8',
          workflow_id: 'workflow-7',
          status: 'stale_detected',
          reason: 'orchestrator_task_still_active',
          task_id: 'task-active',
        }),
      ],
    });
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_stale_detected',
        data: expect.objectContaining({
          activation_id: 'activation-8',
          task_id: 'task-active',
        }),
      }),
      client,
    );
  });

  it('does not emit duplicate stale-detected events once the same stuck task was already reported', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations wa') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-9',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-8',
              activation_id: 'activation-9',
              request_id: 'req-9',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-9' },
              state: 'processing',
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: new Date('2026-03-11T00:02:00Z'),
              consumed_at: null,
              completed_at: null,
              summary: 'Stale orchestrator detected during activation recovery',
              error: {
                recovery: {
                  status: 'stale_detected',
                  reason: 'orchestrator_task_still_active',
                  task_id: 'task-active',
                },
              },
              active_task_id: 'task-active',
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new WorkflowActivationDispatchService({
      pool: {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (sql.includes('SELECT wa.id, wa.tenant_id')) {
            expect(params).toEqual([
              300_000,
              20,
              ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment'],
            ]);
            return { rowCount: 0, rows: [] };
          }
          throw new Error(`unexpected pool query: ${sql}`);
        }),
        connect: vi.fn(async () => client),
      } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 10_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const recovery = await service.recoverStaleActivations();

    expect(recovery).toEqual({
      requeued: 0,
      redispatched: 0,
      reported: 0,
      details: [],
    });
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('continues stale recovery when one activation candidate throws a generic recovery error', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rowCount: 3,
        rows: [
          { id: 'activation-1', tenant_id: 'tenant-1' },
          { id: 'activation-2', tenant_id: 'tenant-1' },
          { id: 'activation-3', tenant_id: 'tenant-1' },
        ],
      })),
      connect: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 10_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const recoverSpy = vi
      .spyOn(service as never, 'recoverStaleActivation' as never)
      .mockRejectedValueOnce(new Error('stale recovery failed'))
      .mockResolvedValueOnce({
        requeued: 1,
        redispatched: 0,
        reported: 1,
        details: [
          {
            activation_id: 'activation-2',
            workflow_id: 'workflow-2',
            status: 'requeued',
            reason: 'missing_orchestrator_task',
            stale_started_at: '2026-03-11T00:00:00.000Z',
            detected_at: '2026-03-11T00:05:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        requeued: 0,
        redispatched: 1,
        reported: 1,
        details: [
          {
            activation_id: 'activation-3',
            workflow_id: 'workflow-3',
            status: 'redispatched',
            reason: 'missing_orchestrator_task',
            stale_started_at: '2026-03-11T00:01:00.000Z',
            detected_at: '2026-03-11T00:06:00.000Z',
            redispatched_task_id: 'task-3',
          },
        ],
      });

    const recovery = await service.recoverStaleActivations(3);

    expect(recoverSpy).toHaveBeenCalledTimes(3);
    expect(recovery).toEqual({
      requeued: 1,
      redispatched: 1,
      reported: 2,
      details: [
        {
          activation_id: 'activation-2',
          workflow_id: 'workflow-2',
          status: 'requeued',
          reason: 'missing_orchestrator_task',
          stale_started_at: '2026-03-11T00:00:00.000Z',
          detected_at: '2026-03-11T00:05:00.000Z',
        },
        {
          activation_id: 'activation-3',
          workflow_id: 'workflow-3',
          status: 'redispatched',
          reason: 'missing_orchestrator_task',
          stale_started_at: '2026-03-11T00:01:00.000Z',
          detected_at: '2026-03-11T00:06:00.000Z',
          redispatched_task_id: 'task-3',
        },
      ],
    });
  });
});
