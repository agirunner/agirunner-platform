import { describe, expect, it, vi } from 'vitest';

const { logSafetynetTriggeredMock } = vi.hoisted(() => ({
  logSafetynetTriggeredMock: vi.fn(),
}));

vi.mock('../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: logSafetynetTriggeredMock,
}));

import { ConflictError } from '../../src/errors/domain-errors.js';
import { WorkflowActivationService } from '../../src/services/workflow-activation-service.js';

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

  it('returns the existing activation row when request_id conflicts', async () => {
    logSafetynetTriggeredMock.mockReset();
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('request_id = $3')) {
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
        request_id: 'req-1',
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(logSafetynetTriggeredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'platform.control_plane.idempotent_mutation_replay',
      }),
      'idempotent workflow activation replay returned stored activation event',
      expect.objectContaining({
        workflow_id: 'workflow-1',
        request_id: 'req-1',
        event_type: 'work_item.created',
      }),
    );
  });

  it('treats activation payloads with reordered object keys as the same request replay', async () => {
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
              payload: { stage_name: 'requirements', work_item_id: 'wi-1' },
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
      reason: 'work_item.created',
      event_type: 'work_item.created',
      payload: { work_item_id: 'wi-1', stage_name: 'requirements' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'activation-1',
        request_id: 'req-1',
      }),
    );
  });

  it('rejects a request_id replay when the existing activation payload does not match', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('request_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-1',
              reason: 'work_item.created',
              event_type: 'work_item.created',
              payload: { work_item_id: 'wi-existing' },
              state: 'queued',
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

    await expect(
      service.enqueue(identity, 'workflow-1', {
        request_id: 'req-1',
        reason: 'work_item.created',
        event_type: 'work_item.created',
        payload: { work_item_id: 'wi-new' },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

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
