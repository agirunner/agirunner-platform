import { describe, expect, it, vi } from 'vitest';

import { WorkflowActivationService } from '../../../src/services/workflow-activation-service.js';

const identity = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin' as const,
  ownerType: 'tenant',
  ownerId: 'tenant-1',
  keyPrefix: 'admin-key',
};

describe('WorkflowActivationService', () => {
  it('reads a single grouped activation batch by activation id', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.includes('FROM workflow_activations')) {
          expect(params?.[2]).toBe('activation-1');
          return {
            rowCount: 2,
            rows: [
              {
                id: 'activation-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                request_id: 'req-1',
                reason: 'work_item.created',
                event_type: 'work_item.created',
                payload: { work_item_id: 'wi-1' },
                state: 'completed',
                queued_at: new Date('2026-03-11T00:00:00Z'),
                started_at: new Date('2026-03-11T00:00:10Z'),
                consumed_at: new Date('2026-03-11T00:00:25Z'),
                completed_at: new Date('2026-03-11T00:00:25Z'),
                summary: 'done',
                error: null,
              },
              {
                id: 'activation-2',
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                request_id: 'req-2',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: { task_id: 'task-9' },
                state: 'completed',
                queued_at: new Date('2026-03-11T00:00:05Z'),
                started_at: new Date('2026-03-11T00:00:10Z'),
                consumed_at: new Date('2026-03-11T00:00:25Z'),
                completed_at: new Date('2026-03-11T00:00:25Z'),
                summary: 'done',
                error: null,
              },
            ],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new WorkflowActivationService(pool as never, { emit: vi.fn() } as never);

    const result = await service.get(identity.tenantId, 'workflow-1', 'activation-1');

    expect(result.data).toEqual(
      expect.objectContaining({
        id: 'activation-1',
        activation_id: 'activation-1',
        state: 'completed',
        event_types: ['work_item.created', 'task.completed'],
        event_count: 2,
        summary: 'done',
        events: [
          expect.objectContaining({ id: 'activation-1' }),
          expect.objectContaining({ id: 'activation-2' }),
        ],
      }),
    );
  });

  it('surfaces persisted stale recovery metadata in activation responses', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.includes('FROM workflow_activations')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'activation-7',
                workflow_id: 'workflow-1',
                activation_id: 'activation-7',
                request_id: 'req-7',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: { task_id: 'task-7' },
                state: 'processing',
                queued_at: new Date('2026-03-11T00:00:00Z'),
                started_at: new Date('2026-03-11T00:00:10Z'),
                consumed_at: null,
                completed_at: null,
                summary: 'Recovered stale workflow activation',
                error: {
                  message: 'Recovered stale workflow activation',
                  recovery: {
                    status: 'redispatched',
                    reason: 'missing_orchestrator_task',
                    detected_at: '2026-03-11T00:05:00.000Z',
                    stale_started_at: '2026-03-11T00:00:10.000Z',
                    stale_after_ms: 300000,
                    recovered_at: '2026-03-11T00:05:00.000Z',
                    redispatched_at: '2026-03-11T00:05:01.000Z',
                    redispatched_task_id: 'task-99',
                  },
                },
              },
            ],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new WorkflowActivationService(pool as never, { emit: vi.fn() } as never);

    const result = await service.get(identity.tenantId, 'workflow-1', 'activation-7');

    expect(result.data).toEqual(
      expect.objectContaining({
        recovery: expect.objectContaining({
          status: 'redispatched',
          reason: 'missing_orchestrator_task',
          redispatched_task_id: 'task-99',
        }),
        recovery_status: 'redispatched',
        recovery_reason: 'missing_orchestrator_task',
        recovery_detected_at: '2026-03-11T00:05:00.000Z',
        event_types: ['task.completed'],
        events: [
          expect.objectContaining({
            recovery: expect.objectContaining({
              status: 'redispatched',
            }),
          }),
        ],
      }),
    );
  });

  it('redacts plaintext secrets from grouped activation event payloads on reads', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.includes('FROM workflow_activations')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'activation-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                request_id: 'req-1',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: {
                  refresh_token: 'plaintext-refresh-token',
                  nested: { secret_ref: 'secret:SAFE_TOKEN' },
                },
                state: 'completed',
                queued_at: new Date('2026-03-11T00:00:00Z'),
                started_at: new Date('2026-03-11T00:00:10Z'),
                consumed_at: new Date('2026-03-11T00:00:20Z'),
                completed_at: new Date('2026-03-11T00:00:20Z'),
                summary: 'done',
                error: null,
              },
            ],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new WorkflowActivationService(pool as never, { emit: vi.fn() } as never);

    const result = await service.get(identity.tenantId, 'workflow-1', 'activation-1');

    expect((result.data.payload as Record<string, any>).refresh_token).toBe('redacted://activation-secret');
    expect((result.data.events[0] as Record<string, any>).payload.nested.secret_ref).toBe('redacted://activation-secret');
  });

  it('caps grouped activation batches by limit even when many event rows are present', async () => {
    const activationRows = Array.from({ length: 100 }, (_, batchIndex) => [
      {
        id: `activation-${batchIndex}-anchor`,
        workflow_id: 'workflow-1',
        activation_id: `activation-${batchIndex}`,
        request_id: `req-${batchIndex}-a`,
        reason: 'work_item.created',
        event_type: 'work_item.created',
        payload: { work_item_id: `wi-${batchIndex}` },
        state: 'completed',
        queued_at: new Date(`2026-03-11T00:00:${String(batchIndex % 60).padStart(2, '0')}Z`),
        started_at: new Date(`2026-03-11T00:01:${String(batchIndex % 60).padStart(2, '0')}Z`),
        consumed_at: new Date(`2026-03-11T00:02:${String(batchIndex % 60).padStart(2, '0')}Z`),
        completed_at: new Date(`2026-03-11T00:02:${String(batchIndex % 60).padStart(2, '0')}Z`),
        summary: 'done',
        error: null,
      },
      {
        id: `activation-${batchIndex}-follow`,
        workflow_id: 'workflow-1',
        activation_id: `activation-${batchIndex}`,
        request_id: `req-${batchIndex}-b`,
        reason: 'task.completed',
        event_type: 'task.completed',
        payload: { task_id: `task-${batchIndex}` },
        state: 'completed',
        queued_at: new Date(`2026-03-11T00:03:${String(batchIndex % 60).padStart(2, '0')}Z`),
        started_at: new Date(`2026-03-11T00:03:${String(batchIndex % 60).padStart(2, '0')}Z`),
        consumed_at: new Date(`2026-03-11T00:04:${String(batchIndex % 60).padStart(2, '0')}Z`),
        completed_at: new Date(`2026-03-11T00:04:${String(batchIndex % 60).padStart(2, '0')}Z`),
        summary: 'done',
        error: null,
      },
    ]).flat();

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.includes('FROM workflow_activations')) {
          return { rowCount: activationRows.length, rows: activationRows };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new WorkflowActivationService(pool as never, { emit: vi.fn() } as never);

    const result = await service.listWorkflowActivations(identity.tenantId, 'workflow-1', {
      limit: 10,
    });

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(10);
    expect(result.every((activation) => activation.event_count === 2)).toBe(true);
    expect(result[0]?.activation_id).toBe('activation-0');
    expect(result[9]?.activation_id).toBe('activation-9');
  });
});
