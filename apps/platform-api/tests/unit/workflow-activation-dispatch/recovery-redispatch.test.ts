import { describe, expect, it, vi } from 'vitest';

import { WorkflowActivationDispatchService } from './test-harness.js';

describe('WorkflowActivationDispatchService', () => {
  it('requeues and redispatches stale activations that lost their orchestrator task', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations wa') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-5',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-9',
              activation_id: 'activation-5',
              request_id: 'req-5',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-5' },
              state: 'processing',
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: new Date('2026-03-11T00:01:00Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
              active_task_id: null,
            }],
          };
        }
        if (sql.includes('SET state = \'queued\'')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-9',
            'activation-5',
            '2026-03-11T00:01:00.000Z',
            300000,
          ]);
          return {
            rowCount: 2,
            rows: [
              {
                id: 'activation-5',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-9',
                activation_id: null,
                request_id: 'req-5',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: { task_id: 'task-5' },
                state: 'queued',
                queued_at: new Date('2026-03-11T00:00:00Z'),
                started_at: null,
                consumed_at: null,
                completed_at: null,
                summary: 'Recovered stale workflow activation',
                error: {
                  message: 'Recovered stale workflow activation',
                  recovery: {
                    status: 'requeued',
                    reason: 'missing_orchestrator_task',
                  },
                },
              },
              {
                id: 'activation-6',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-9',
                activation_id: null,
                request_id: 'req-6',
                reason: 'stage.changed',
                event_type: 'stage.changed',
                payload: { stage_name: 'qa' },
                state: 'queued',
                queued_at: new Date('2026-03-11T00:00:03Z'),
                started_at: null,
                consumed_at: null,
                completed_at: null,
                summary: 'Recovered stale workflow activation',
                error: {
                  message: 'Recovered stale workflow activation',
                  recovery: {
                    status: 'requeued',
                    reason: 'missing_orchestrator_task',
                  },
                },
              },
            ],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (sql.includes('SELECT wa.id, wa.tenant_id')) {
            return { rowCount: 1, rows: [{ id: 'activation-5', tenant_id: 'tenant-1' }] };
          }
          if (sql.includes('redispatched_task_id')) {
            expect(params).toEqual(['tenant-1', 'workflow-9', 'activation-5', 'task-recovered']);
            return { rowCount: 2, rows: [] };
          }
          throw new Error(`unexpected pool query: ${sql}`);
        }),
        connect: vi.fn(async () => client),
      } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 10_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi.spyOn(service, 'dispatchActivation').mockResolvedValue('task-recovered');

    const recovery = await service.recoverStaleActivations();

    expect(recovery).toEqual({
      requeued: 1,
      redispatched: 1,
      reported: 1,
      details: [
        expect.objectContaining({
          activation_id: 'activation-5',
          workflow_id: 'workflow-9',
          status: 'redispatched',
          reason: 'missing_orchestrator_task',
          redispatched_task_id: 'task-recovered',
        }),
      ],
    });
    expect(dispatchSpy).toHaveBeenCalledWith('tenant-1', 'activation-5', undefined, {
      ignoreDelay: true,
    });
  });

  it('reports the real trigger metadata when stale recovery requeues a heartbeat-anchored mixed batch', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations wa') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-heartbeat',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-9',
              activation_id: 'activation-heartbeat',
              request_id: 'heartbeat:workflow-9:5911344',
              reason: 'heartbeat',
              event_type: 'heartbeat',
              payload: {},
              state: 'processing',
              queued_at: new Date('2026-03-13T12:00:00Z'),
              started_at: new Date('2026-03-13T12:01:00Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
              active_task_id: null,
            }],
          };
        }
        if (sql.includes('SET state = \'queued\'')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: 'activation-heartbeat',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-9',
                activation_id: null,
                request_id: 'heartbeat:workflow-9:5911344',
                reason: 'heartbeat',
                event_type: 'heartbeat',
                payload: {},
                state: 'queued',
                queued_at: new Date('2026-03-13T12:00:00Z'),
                started_at: null,
                consumed_at: null,
                completed_at: null,
                summary: 'Recovered stale workflow activation',
                error: {
                  message: 'Recovered stale workflow activation',
                  recovery: {
                    status: 'requeued',
                    reason: 'missing_orchestrator_task',
                  },
                },
              },
              {
                id: 'activation-task-completed',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-9',
                activation_id: null,
                request_id: 'req-task-completed',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: { task_id: 'task-9', work_item_id: 'wi-9' },
                state: 'queued',
                queued_at: new Date('2026-03-13T12:00:02Z'),
                started_at: null,
                consumed_at: null,
                completed_at: null,
                summary: 'Recovered stale workflow activation',
                error: {
                  message: 'Recovered stale workflow activation',
                  recovery: {
                    status: 'requeued',
                    reason: 'missing_orchestrator_task',
                  },
                },
              },
            ],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (sql.includes('SELECT wa.id, wa.tenant_id')) {
            return { rowCount: 1, rows: [{ id: 'activation-heartbeat', tenant_id: 'tenant-1' }] };
          }
          if (sql.includes('redispatched_task_id')) {
            expect(params).toEqual(['tenant-1', 'workflow-9', 'activation-heartbeat', 'task-recovered']);
            return { rowCount: 2, rows: [] };
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
    vi.spyOn(service, 'dispatchActivation').mockResolvedValue('task-recovered');

    await service.recoverStaleActivations();

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_requeued',
        entityId: 'workflow-9',
        data: expect.objectContaining({
          activation_id: 'activation-heartbeat',
          event_type: 'task.completed',
          reason: 'queued_events',
          event_count: 1,
        }),
      }),
      client,
    );
  });
});
