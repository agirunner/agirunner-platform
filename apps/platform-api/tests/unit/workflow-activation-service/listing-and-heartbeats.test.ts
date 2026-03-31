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
  it('lists persisted activation events for a workflow', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.includes('FROM workflow_activations')) {
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
                state: 'processing',
                queued_at: new Date('2026-03-11T00:00:00Z'),
                started_at: new Date('2026-03-11T00:00:10Z'),
                consumed_at: null,
                completed_at: null,
                summary: null,
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
                state: 'queued',
                queued_at: new Date('2026-03-11T00:00:05Z'),
                started_at: new Date('2026-03-11T00:00:10Z'),
                consumed_at: null,
                completed_at: null,
                summary: null,
                error: null,
              },
            ],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new WorkflowActivationService(pool as never, { emit: vi.fn() } as never);

    const result = await service.list(identity.tenantId, 'workflow-1');

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        id: 'activation-1',
        activation_id: 'activation-1',
        state: 'processing',
        event_types: ['work_item.created', 'task.completed'],
        event_count: 2,
        events: [
          expect.objectContaining({
            id: 'activation-1',
            event_type: 'work_item.created',
          }),
          expect.objectContaining({
            id: 'activation-2',
            event_type: 'task.completed',
          }),
        ],
      }),
    );
  });

  it('serializes heartbeat-only activations without pseudo-event rows', async () => {
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
                id: 'activation-heartbeat',
                workflow_id: 'workflow-1',
                activation_id: 'activation-heartbeat',
                request_id: 'heartbeat:workflow-1:5911344',
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
              },
            ],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new WorkflowActivationService(pool as never, { emit: vi.fn() } as never);

    const result = await service.get(identity.tenantId, 'workflow-1', 'activation-heartbeat');

    expect(result.data).toEqual(
      expect.objectContaining({
        id: 'activation-heartbeat',
        activation_id: 'activation-heartbeat',
        request_id: 'heartbeat:workflow-1:5911344',
        reason: 'heartbeat',
        event_type: 'heartbeat',
        activation_reason: 'heartbeat',
        event_types: ['heartbeat'],
        event_count: 0,
        events: [],
      }),
    );
  });

  it('surfaces the real trigger event for mixed batches anchored by a heartbeat row', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.includes('FROM workflow_activations')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: 'activation-heartbeat',
                workflow_id: 'workflow-1',
                activation_id: 'activation-heartbeat',
                request_id: 'heartbeat:workflow-1:5911344',
                reason: 'heartbeat',
                event_type: 'heartbeat',
                payload: {},
                state: 'processing',
                dispatch_attempt: 1,
                dispatch_token: 'dispatch-token-1',
                queued_at: new Date('2026-03-13T12:00:00Z'),
                started_at: new Date('2026-03-13T12:00:05Z'),
                consumed_at: null,
                completed_at: null,
                summary: null,
                error: null,
              },
              {
                id: 'activation-task-completed',
                workflow_id: 'workflow-1',
                activation_id: 'activation-heartbeat',
                request_id: 'req-task-completed',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: { task_id: 'task-9', work_item_id: 'wi-9' },
                state: 'queued',
                dispatch_attempt: 1,
                dispatch_token: 'dispatch-token-1',
                queued_at: new Date('2026-03-13T12:00:06Z'),
                started_at: new Date('2026-03-13T12:00:05Z'),
                consumed_at: null,
                completed_at: null,
                summary: null,
                error: null,
              },
            ],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new WorkflowActivationService(pool as never, { emit: vi.fn() } as never);

    const result = await service.get(identity.tenantId, 'workflow-1', 'activation-heartbeat');

    expect(result.data).toEqual(
      expect.objectContaining({
        id: 'activation-heartbeat',
        activation_id: 'activation-heartbeat',
        request_id: 'heartbeat:workflow-1:5911344',
        reason: 'task.completed',
        event_type: 'task.completed',
        activation_reason: 'queued_events',
        payload: { task_id: 'task-9', work_item_id: 'wi-9' },
        event_types: ['task.completed'],
        event_count: 1,
        events: [
          expect.objectContaining({
            id: 'activation-task-completed',
            event_type: 'task.completed',
            reason: 'task.completed',
          }),
        ],
      }),
    );
  });

  it('filters workflow activations by recovery status and returns derived recovery fields', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.includes('FROM workflow_activations')) {
          expect(sql).toContain("COALESCE(error->'recovery'->>'status', '') = $3");
          expect(params).toEqual(['tenant-1', 'workflow-1', 'redispatched']);
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

    const result = await service.listWorkflowActivations(identity.tenantId, 'workflow-1', {
      recovery_status: 'redispatched',
    });

    expect(result).toEqual([
      expect.objectContaining({
        recovery_status: 'redispatched',
        recovery_reason: 'missing_orchestrator_task',
        recovery_detected_at: '2026-03-11T00:05:00.000Z',
        redispatched_task_id: 'task-99',
      }),
    ]);
  });
});
