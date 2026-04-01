import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: vi.fn(),
}));

import { logSafetynetTriggered } from '../../../src/services/safetynet/logging.js';

import { WorkflowActivationDispatchService } from './test-harness.js';

describe('WorkflowActivationDispatchService safetynet recovery', () => {
  it('logs when stale activation recovery requeues and redispatches a missing orchestrator task', async () => {
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
            rowCount: 1,
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
            ],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('SELECT wa.id, wa.tenant_id')) {
            return { rowCount: 1, rows: [{ id: 'activation-5', tenant_id: 'tenant-1' }] };
          }
          if (sql.includes('redispatched_task_id')) {
            return { rowCount: 1, rows: [] };
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
    vi.spyOn(service, 'dispatchActivation').mockResolvedValue('task-recovered');

    await service.recoverStaleActivations();

    expect(logSafetynetTriggered).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'platform.activation.stale_activation_recovery',
      }),
      'stale activation recovery requeued and redispatched a missing orchestrator task',
      expect.objectContaining({
        workflow_id: 'workflow-9',
        activation_id: 'activation-5',
        redispatched_task_id: 'task-recovered',
        recovery_reason: 'missing_orchestrator_task',
      }),
    );
  });
});
