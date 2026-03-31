import { describe, expect, it, vi } from 'vitest';

const { logSafetynetTriggeredMock } = vi.hoisted(() => ({
  logSafetynetTriggeredMock: vi.fn(),
}));

vi.mock('../../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: logSafetynetTriggeredMock,
}));

import { WorkflowActivationService } from '../../../../src/services/workflow-activation/workflow-activation-service.js';

const identity = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin' as const,
  ownerType: 'tenant',
  ownerId: 'tenant-1',
  keyPrefix: 'admin-key',
};

describe('WorkflowActivationService', () => {
  it('enqueues a workflow activation event and emits a queued event', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-1',
              reason: 'work_item.created',
              event_type: 'work_item.created',
              payload: { work_item_id: 'wi-1' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn() };
    const service = new WorkflowActivationService(pool as never, eventService as never);

    const result = await service.enqueue(identity, 'workflow-1', {
      request_id: 'req-1',
      reason: 'work_item.created',
      event_type: 'work_item.created',
      payload: { work_item_id: 'wi-1' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'activation-1',
        activation_id: 'activation-1',
        workflow_id: 'workflow-1',
        state: 'queued',
        dispatch_attempt: 0,
        events: [
          expect.objectContaining({
            id: 'activation-1',
            event_type: 'work_item.created',
          }),
        ],
      }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_queued',
        data: expect.objectContaining({ activation_id: 'activation-1' }),
      }),
      undefined,
    );
  });

  it('does not queue activation work while the workflow is paused', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          expect(sql).toContain("WHEN w.state = 'paused'");
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-2',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-paused',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-1' },
              state: 'completed',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: null,
              consumed_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: new Date('2026-03-11T00:00:00Z'),
              summary: 'Ignored activation because workflow is paused.',
              error: null,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn() };
    const service = new WorkflowActivationService(pool as never, eventService as never);

    const result = await service.enqueue(identity, 'workflow-1', {
      request_id: 'req-paused',
      reason: 'task.completed',
      event_type: 'task.completed',
      payload: { task_id: 'task-1' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'activation-2',
        state: 'completed',
        summary: 'Ignored activation because workflow is paused.',
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('does not queue activation work once workflow cancellation is in progress', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          expect(sql).toContain("metadata->>'cancel_requested_at'");
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-3',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-cancelling',
              reason: 'task.failed',
              event_type: 'task.failed',
              payload: { task_id: 'task-2' },
              state: 'completed',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: null,
              consumed_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: new Date('2026-03-11T00:00:00Z'),
              summary: 'Ignored activation because workflow cancellation is already in progress.',
              error: null,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn() };
    const service = new WorkflowActivationService(pool as never, eventService as never);

    const result = await service.enqueue(identity, 'workflow-1', {
      request_id: 'req-cancelling',
      reason: 'task.failed',
      event_type: 'task.failed',
      payload: { task_id: 'task-2' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'activation-3',
        state: 'completed',
        summary: 'Ignored activation because workflow cancellation is already in progress.',
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('redacts plaintext secrets in persisted and serialized activation payloads', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          expect(params?.[5]).toEqual({
            api_key: 'redacted://activation-secret',
            nested: {
              authorization: 'redacted://activation-secret',
              secret_ref: 'redacted://activation-secret',
            },
          });
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-1',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: {
                api_key: 'redacted://activation-secret',
                nested: {
                  authorization: 'redacted://activation-secret',
                  secret_ref: 'redacted://activation-secret',
                },
              },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new WorkflowActivationService(pool as never, { emit: vi.fn() } as never);

    const result = await service.enqueue(identity, 'workflow-1', {
      request_id: 'req-1',
      reason: 'task.completed',
      event_type: 'task.completed',
      payload: {
        api_key: 'sk-live-secret',
        nested: {
          authorization: 'Bearer header.payload.signature',
          secret_ref: 'secret:ACTIVATION_TOKEN',
        },
      },
    });

    expect((result.payload as Record<string, any>).api_key).toBe('redacted://activation-secret');
    expect((result.payload as Record<string, any>).nested.authorization).toBe('redacted://activation-secret');
    expect((result.payload as Record<string, any>).nested.secret_ref).toBe('redacted://activation-secret');
  });
});
