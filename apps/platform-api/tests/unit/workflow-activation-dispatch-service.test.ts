import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/platform-timing-defaults.js', () => ({
  readWorkflowActivationTimingDefaults: vi.fn(
    async (
      _db: unknown,
      fallback: Partial<{
        delayMs: number;
        heartbeatIntervalMs: number;
        staleAfterMs: number;
      }> = {},
    ) => ({
      activationDelayMs: fallback.delayMs ?? 10_000,
      heartbeatIntervalMs: fallback.heartbeatIntervalMs ?? 900_000,
      staleAfterMs: fallback.staleAfterMs ?? 300_000,
    }),
  ),
}));

import { WorkflowActivationDispatchService } from '../../src/services/workflow-activation-dispatch-service.js';

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
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_review'],
            300_000,
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_review'],
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
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_review'],
            300_000,
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_review'],
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
          ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_review'],
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

  it('dispatches a heartbeat-only activation with empty events and heartbeat telemetry', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-heartbeat',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
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
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = false')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              project_id: 'project-1',
              lifecycle: 'ongoing',
              current_stage: null,
              active_stages: ['triage'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-heartbeat',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-heartbeat',
              request_id: 'heartbeat:workflow-1:5911344',
              reason: 'heartbeat',
              event_type: 'heartbeat',
              payload: {},
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-heartbeat',
              queued_at: new Date('2026-03-13T12:00:00Z'),
              started_at: new Date('2026-03-13T12:00:05Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          expect(params?.[5]).toBe('triage');
          expect(params?.[6]).toEqual(
            expect.objectContaining({
              activation_id: 'activation-heartbeat',
              activation_reason: 'heartbeat',
              activation_dispatch_attempt: 1,
              activation_dispatch_token: 'dispatch-token-heartbeat',
              active_stages: ['triage'],
              events: [],
            }),
          );
          expect(params?.[14]).toEqual(
            expect.objectContaining({
              activation_event_type: 'heartbeat',
              activation_reason: 'heartbeat',
              activation_event_count: 0,
            }),
          );
          return { rowCount: 1, rows: [{ id: 'task-heartbeat' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-heartbeat');

    expect(taskId).toBe('task-heartbeat');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_started',
        data: expect.objectContaining({
          activation_id: 'activation-heartbeat',
          event_type: 'heartbeat',
          reason: 'heartbeat',
          event_count: 0,
          task_id: 'task-heartbeat',
        }),
      }),
      client,
    );
  });

  it('uses the runtime default task timeout when dispatching orchestrator work', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-runtime-default',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
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
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = false')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              project_id: 'project-1',
              lifecycle: 'ongoing',
              current_stage: null,
              active_stages: ['triage'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-runtime-default',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-runtime-default',
              request_id: 'heartbeat:workflow-1:5911344',
              reason: 'heartbeat',
              event_type: 'heartbeat',
              payload: {},
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-runtime-default',
              queued_at: new Date('2026-03-13T12:00:00Z'),
              started_at: new Date('2026-03-13T12:00:05Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('FROM runtime_defaults') && sql.includes('config_key = $2')) {
          return {
            rowCount: 1,
            rows: [{ config_value: '45' }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          expect(params?.[13]).toBe(45);
          return { rowCount: 1, rows: [{ id: 'task-runtime-default' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      config: {
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      } as never,
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-runtime-default');

    expect(taskId).toBe('task-runtime-default');
  });

  it('completes heartbeat-only activations without dispatch when specialist work is still running', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-heartbeat',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
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
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              project_id: 'project-1',
              lifecycle: 'ongoing',
              current_stage: null,
              active_stages: ['triage'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-heartbeat',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-heartbeat',
              request_id: 'heartbeat:workflow-1:5911344',
              reason: 'heartbeat',
              event_type: 'heartbeat',
              payload: {},
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-heartbeat',
              queued_at: new Date('2026-03-13T12:00:00Z'),
              started_at: new Date('2026-03-13T12:00:05Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = false')) {
          return { rowCount: 1, rows: [{ '?column?': 1 }] };
        }
        if (sql.includes("SET state = 'completed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-heartbeat',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-heartbeat',
              request_id: 'heartbeat:workflow-1:5911344',
              reason: 'heartbeat',
              event_type: 'heartbeat',
              payload: {},
              state: 'completed',
              dispatch_attempt: 1,
              dispatch_token: null,
              queued_at: new Date('2026-03-13T12:00:00Z'),
              started_at: new Date('2026-03-13T12:00:05Z'),
              consumed_at: new Date('2026-03-13T12:00:05Z'),
              completed_at: new Date('2026-03-13T12:00:05Z'),
              summary: 'heartbeat skipped while specialist work is still in progress',
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          throw new Error('heartbeat should not dispatch orchestrator task while specialist work is active');
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-heartbeat');

    expect(taskId).toBeNull();
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_completed',
        data: expect.objectContaining({
          activation_id: 'activation-heartbeat',
          event_type: 'heartbeat',
          reason: 'heartbeat',
          task_id: null,
          event_count: 0,
          summary: 'heartbeat skipped while specialist work is still in progress',
        }),
      }),
      client,
    );
  });

  it('treats heartbeat-anchor batches with queued events as queued-event activations', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-heartbeat',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
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
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              project_id: 'project-1',
              lifecycle: 'ongoing',
              current_stage: null,
              active_stages: ['implementation'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: 'activation-heartbeat',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-heartbeat',
                request_id: 'heartbeat:workflow-1:5911344',
                reason: 'heartbeat',
                event_type: 'heartbeat',
                payload: {},
                state: 'processing',
                dispatch_attempt: 1,
                dispatch_token: 'dispatch-token-heartbeat',
                queued_at: new Date('2026-03-13T12:00:00Z'),
                started_at: new Date('2026-03-13T12:00:05Z'),
                consumed_at: null,
                completed_at: null,
                summary: null,
                error: null,
              },
              {
                id: 'activation-task-completed',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-heartbeat',
                request_id: 'req-task-completed',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: { task_id: 'task-9', work_item_id: 'wi-9', stage_name: 'implementation' },
                state: 'queued',
                dispatch_attempt: 1,
                dispatch_token: 'dispatch-token-heartbeat',
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
        if (sql.includes('INSERT INTO tasks')) {
          expect(params?.[6]).toEqual(
            expect.objectContaining({
              activation_id: 'activation-heartbeat',
              activation_reason: 'queued_events',
              events: [
                expect.objectContaining({
                  queue_id: 'activation-task-completed',
                  type: 'task.completed',
                }),
              ],
            }),
          );
          expect(params?.[14]).toEqual(
            expect.objectContaining({
              activation_event_type: 'task.completed',
              activation_reason: 'queued_events',
              activation_event_count: 1,
            }),
          );
          return { rowCount: 1, rows: [{ id: 'task-mixed' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-heartbeat');

    expect(taskId).toBe('task-mixed');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_started',
        data: expect.objectContaining({
          activation_id: 'activation-heartbeat',
          event_type: 'task.completed',
          reason: 'queued_events',
          event_count: 1,
          task_id: 'task-mixed',
        }),
      }),
      client,
    );
  });

  it('uses work-item-driven active stages for continuous workflow dispatch input', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-1',
              reason: 'work_item.created',
              event_type: 'work_item.created',
              payload: { work_item_id: 'wi-1', stage_name: 'triage' },
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain("WHERE w.lifecycle <> 'ongoing'");
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              project_id: 'project-1',
              lifecycle: 'ongoing',
              current_stage: null,
              active_stages: ['triage'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
              project_repository_url: null,
              project_settings: null,
              workflow_git_branch: null,
              workflow_parameters: null,
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              request_id: 'req-1',
              reason: 'work_item.created',
              event_type: 'work_item.created',
              payload: { work_item_id: 'wi-1', stage_name: 'triage' },
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-1',
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: new Date('2026-03-11T00:00:10Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          expect(params?.[6]).toEqual(
            expect.objectContaining({
              activation_reason: 'queued_events',
              active_stages: ['triage'],
            }),
          );
          return { rowCount: 1, rows: [{ id: 'task-1' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-1');

    expect(taskId).toBe('task-1');
  });

  it('dispatches an idle work item activation immediately into a batched orchestrator task', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              tenant_id: 'tenant-1',
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).not.toContain('w.current_stage');
          expect(sql).toContain('current_stage_summary.current_stage');
          expect(sql).toContain('open_work_item_count');
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              project_id: 'project-1',
              lifecycle: 'ongoing',
              current_stage: null,
              active_stages: ['implementation'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
              project_repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              project_settings: { default_branch: 'main' },
              workflow_git_branch: null,
              workflow_parameters: {
                branch: 'main',
                feature_branch: 'smoke/test/fix',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.com',
                git_token_secret_ref: 'secret:GITHUB_PAT',
              },
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          expect(params?.slice(0, 3)).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          expect(params?.[3]).toEqual(expect.any(String));
          return {
            rowCount: 2,
            rows: [
              {
                id: 'activation-1',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                request_id: 'req-1',
                reason: 'work_item.created',
                event_type: 'work_item.created',
                payload: { work_item_id: 'wi-1' },
                state: 'processing',
                dispatch_attempt: 1,
                dispatch_token: 'dispatch-token-1',
                queued_at: new Date('2026-03-11T00:00:00Z'),
                started_at: new Date('2026-03-11T00:00:10Z'),
                consumed_at: null,
                completed_at: null,
                summary: null,
                error: null,
              },
              {
                id: 'activation-2',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                request_id: 'req-2',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: { task_id: 'task-9', work_item_id: 'wi-2', stage_name: 'implementation' },
                state: 'queued',
                dispatch_attempt: 1,
                dispatch_token: 'dispatch-token-1',
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
        if (sql.includes('INSERT INTO tasks')) {
          expect(params?.[5]).toBe('implementation');
          expect(params?.[6]).not.toHaveProperty('current_stage');
          expect(params?.[6]).toEqual(
            expect.objectContaining({
              activation_id: 'activation-1',
              activation_reason: 'queued_events',
              activation_dispatch_attempt: 1,
              activation_dispatch_token: 'dispatch-token-1',
              active_stages: ['implementation'],
              events: [
                expect.objectContaining({ queue_id: 'activation-1', type: 'work_item.created' }),
                expect.objectContaining({ queue_id: 'activation-2', type: 'task.completed' }),
              ],
            }),
          );
          expect(params?.[9]).toEqual(
            expect.objectContaining({
              execution_mode: 'orchestrator',
              template: 'execution-workspace',
              repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              branch: 'main',
              git_user_name: 'Smoke Bot',
              git_user_email: 'smoke@example.com',
            }),
          );
          expect(params?.[10]).toBe(JSON.stringify([
            {
              type: 'git_repository',
              repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              credentials: { token: 'secret:GITHUB_PAT' },
            },
          ]));
          return { rowCount: 1, rows: [{ id: 'task-1' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-1');

    expect(taskId).toBe('task-1');
  });

  it('dispatches a large queued activation batch into a single orchestrator task', async () => {
    const activationRows = Array.from({ length: 200 }, (_, index) => ({
      id: `activation-${index + 1}`,
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      activation_id: 'activation-1',
      request_id: `req-${index + 1}`,
      reason: index === 0 ? 'work_item.created' : 'task.completed',
      event_type: index === 0 ? 'work_item.created' : 'task.completed',
      payload:
        index === 0
          ? { work_item_id: 'wi-root' }
          : { task_id: `task-${index}`, work_item_id: `wi-${index}`, stage_name: 'implementation' },
      state: index === 0 ? 'processing' : 'queued',
      dispatch_attempt: 1,
      dispatch_token: 'dispatch-token-1',
      queued_at: new Date(`2026-03-11T00:00:${String(index % 60).padStart(2, '0')}Z`),
      started_at: new Date('2026-03-11T00:02:00Z'),
      consumed_at: null,
      completed_at: null,
      summary: null,
      error: null,
    }));

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [activationRows[0]],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              project_id: 'project-1',
              lifecycle: 'ongoing',
              current_stage: null,
              active_stages: ['implementation'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          expect(params?.slice(0, 3)).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          expect(params?.[3]).toEqual(expect.any(String));
          return {
            rowCount: activationRows.length,
            rows: activationRows,
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          expect(params?.[5]).toBe('implementation');
          expect(params?.[6]).toEqual(
            expect.objectContaining({
              activation_id: 'activation-1',
              activation_reason: 'queued_events',
              activation_dispatch_attempt: 1,
              activation_dispatch_token: 'dispatch-token-1',
              active_stages: ['implementation'],
              events: expect.arrayContaining([
                expect.objectContaining({ queue_id: 'activation-1', type: 'work_item.created' }),
                expect.objectContaining({ queue_id: 'activation-200', type: 'task.completed' }),
              ]),
            }),
          );
          expect((params?.[6] as { events: unknown[] }).events).toHaveLength(200);
          return { rowCount: 1, rows: [{ id: 'task-batched' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-1');

    expect(taskId).toBe('task-batched');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tasks'),
      expect.any(Array),
    );
    expect(
      client.query.mock.calls.filter(([sql]) => String(sql).includes('SET activation_id = $3')),
    ).toHaveLength(1);
    expect(
      client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO tasks')),
    ).toHaveLength(1);
  });

  it('hydrates orchestrator activation tasks with repository execution defaults', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-repo',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-repo',
              reason: 'workflow.created',
              event_type: 'workflow.created',
              payload: { stage_name: 'requirements' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-12T00:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow Repo',
              project_id: 'project-1',
              lifecycle: 'planned',
              current_stage: 'requirements',
              active_stages: [],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship code',
              project_repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              project_settings: {
                default_branch: 'main',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.test',
                credentials: {
                  git_token: 'secret:GITHUB_PAT',
                },
              },
              workflow_git_branch: null,
              workflow_parameters: {
                branch: 'main',
                feature_branch: 'smoke/feature-1',
              },
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-repo',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-repo',
              request_id: 'req-repo',
              reason: 'workflow.created',
              event_type: 'workflow.created',
              payload: { stage_name: 'requirements' },
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-repo',
              queued_at: new Date('2026-03-12T00:00:00Z'),
              started_at: new Date('2026-03-12T00:00:01Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          expect(params?.[8]).toEqual(
            expect.objectContaining({
              system_prompt: expect.stringContaining('finish the activation and wait for the next event'),
            }),
          );
          expect((params?.[8] as { system_prompt: string }).system_prompt).toContain('Do not poll running tasks in a loop.');
          expect((params?.[8] as { system_prompt: string }).system_prompt).toContain('If a stage already awaits approval, do not request another gate');
          expect(params?.[9]).toEqual({
            execution_mode: 'orchestrator',
            template: 'execution-workspace',
            repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
            branch: 'main',
            git_user_name: 'Smoke Bot',
            git_user_email: 'smoke@example.test',
          });
          expect(JSON.parse(String(params?.[10] ?? '[]'))).toEqual([
            {
              type: 'git_repository',
              repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              credentials: {
                token: 'secret:GITHUB_PAT',
              },
            },
          ]);
          expect(params?.[6]).toEqual(
            expect.objectContaining({
              current_stage: 'requirements',
              repository: {
                repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
                base_branch: 'main',
                feature_branch: 'smoke/feature-1',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.test',
              },
            }),
          );
          return { rowCount: 1, rows: [{ id: 'task-repo' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-repo');

    expect(taskId).toBe('task-repo');
  });

  it('treats branch-only workflow input as a feature branch and preserves the project default as base branch', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-branch-only',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-branch-only',
              reason: 'workflow.created',
              event_type: 'workflow.created',
              payload: { stage_name: 'requirements' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-12T00:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow Repo',
              project_id: 'project-1',
              lifecycle: 'planned',
              current_stage: 'requirements',
              active_stages: [],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship code',
              project_repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              project_settings: {
                default_branch: 'main',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.test',
                credentials: {
                  git_token: 'secret:GITHUB_PAT',
                },
              },
              workflow_git_branch: null,
              workflow_parameters: {
                branch: 'feature/hello-world',
              },
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-branch-only',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-branch-only',
              request_id: 'req-branch-only',
              reason: 'workflow.created',
              event_type: 'workflow.created',
              payload: { stage_name: 'requirements' },
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-branch-only',
              queued_at: new Date('2026-03-12T00:00:00Z'),
              started_at: new Date('2026-03-12T00:00:01Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          expect(params?.[9]).toEqual({
            execution_mode: 'orchestrator',
            template: 'execution-workspace',
            repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
            branch: 'main',
            git_user_name: 'Smoke Bot',
            git_user_email: 'smoke@example.test',
          });
          expect(params?.[6]).toEqual(
            expect.objectContaining({
              repository: {
                repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
                base_branch: 'main',
                feature_branch: 'feature/hello-world',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.test',
              },
            }),
          );
          return { rowCount: 1, rows: [{ id: 'task-branch-only' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-branch-only');

    expect(taskId).toBe('task-branch-only');
  });

  it('defers non-immediate activations until the batching delay elapses', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-9',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-9',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-9' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date(Date.now() - 5_000),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 10_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-9');

    expect(taskId).toBeNull();
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO tasks'), expect.anything());
  });

  it('reuses an existing orchestrator activation task on insert replay without emitting duplicate events', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              tenant_id: 'tenant-1',
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true') && sql.includes("state = ANY")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              project_id: 'project-1',
              lifecycle: 'ongoing',
              current_stage: null,
              active_stages: ['implementation'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              request_id: 'req-1',
              reason: 'work_item.created',
              event_type: 'work_item.created',
              payload: { work_item_id: 'wi-1' },
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-1',
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: new Date('2026-03-11T00:00:10Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          expect(sql).toContain('ON CONFLICT (tenant_id, workflow_id, request_id)');
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('request_id = $3') && sql.includes('is_orchestrator_task = true')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation:activation-1:dispatch:1']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-existing',
              state: 'ready',
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              is_orchestrator_task: true,
              title: 'Orchestrate Workflow One: work_item.created',
              metadata: { activation_dispatch_attempt: 1 },
              output: null,
              error: null,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-1');

    expect(taskId).toBe('task-existing');
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('reactivates a failed existing orchestrator activation task with refreshed batched input', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              tenant_id: 'tenant-1',
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true') && sql.includes('state = ANY')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              project_id: 'project-1',
              lifecycle: 'ongoing',
              current_stage: null,
              active_stages: ['implementation'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: 'activation-1',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                request_id: 'req-1',
                reason: 'work_item.created',
                event_type: 'work_item.created',
                payload: { work_item_id: 'wi-1' },
                state: 'processing',
                dispatch_attempt: 1,
                dispatch_token: 'dispatch-token-1',
                queued_at: new Date('2026-03-11T00:00:00Z'),
                started_at: new Date('2026-03-11T00:00:10Z'),
                consumed_at: null,
                completed_at: null,
                summary: null,
                error: null,
              },
              {
                id: 'activation-2',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                request_id: 'req-2',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: { task_id: 'task-9', work_item_id: 'wi-2', stage_name: 'implementation' },
                state: 'queued',
                dispatch_attempt: 1,
                dispatch_token: 'dispatch-token-1',
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
        if (sql.includes('INSERT INTO tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('request_id = $3') && sql.includes('is_orchestrator_task = true')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation:activation-1:dispatch:1']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-existing',
              state: 'failed',
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              is_orchestrator_task: true,
              title: 'Orchestrate Workflow One: work_item.created',
              metadata: { activation_dispatch_attempt: 1 },
              output: { summary: 'old output' },
              error: { message: 'old failure' },
            }],
          };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          expect(params?.[0]).toBe('tenant-1');
          expect(params?.[1]).toBe('task-existing');
          expect(params?.[2]).toBe('Orchestrate Workflow One: work_item.created');
          expect(params?.[3]).toBe('implementation');
          expect(params?.[4]).toEqual(
            expect.objectContaining({
              activation_id: 'activation-1',
              activation_reason: 'queued_events',
              activation_dispatch_attempt: 1,
              activation_dispatch_token: 'dispatch-token-1',
              active_stages: ['implementation'],
              events: [
                expect.objectContaining({ queue_id: 'activation-1', type: 'work_item.created' }),
                expect.objectContaining({ queue_id: 'activation-2', type: 'task.completed' }),
              ],
            }),
          );
          expect(params?.[5]).toEqual(expect.any(Object));
          expect(params?.[6]).toEqual({ execution_mode: 'orchestrator' });
          expect(params?.[7]).toBe('[]');
          expect(params?.[8]).toEqual(
            expect.objectContaining({
              activation_event_count: 2,
              activation_dispatch_attempt: 1,
              activation_dispatch_token: 'dispatch-token-1',
              activation_event_type: 'work_item.created',
              activation_reason: 'queued_events',
              activation_request_id: 'req-1',
            }),
          );
          expect(params?.[9]).toBe('activation-1');
          return { rowCount: 1, rows: [{ id: 'task-existing' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-1');

    expect(taskId).toBe('task-existing');
    expect(eventService.emit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'task-existing',
        data: expect.objectContaining({
          previous_state: 'failed',
          state: 'ready',
          reason: 'activation_redispatched',
          activation_id: 'activation-1',
        }),
      }),
      client,
    );
    expect(eventService.emit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'workflow.activation_started',
        data: expect.objectContaining({
          activation_id: 'activation-1',
          event_count: 2,
          task_id: 'task-existing',
        }),
      }),
      client,
    );
  });

  it('finalizes a completed existing activation task on insert replay instead of leaving the activation stuck', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-1',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-9' },
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true') && sql.includes('state = ANY')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              project_id: 'project-1',
              lifecycle: 'ongoing',
              current_stage: null,
              active_stages: ['implementation'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              request_id: 'req-1',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-9' },
              state: 'processing',
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: new Date('2026-03-11T00:00:10Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('request_id = $3') && sql.includes('is_orchestrator_task = true')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-existing',
              state: 'completed',
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              is_orchestrator_task: true,
              title: 'Already completed activation',
              output: { summary: 'already completed' },
              error: null,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const finalizeSpy = vi.spyOn(service, 'finalizeActivationForTask').mockResolvedValue(undefined);

    const taskId = await service.dispatchActivation('tenant-1', 'activation-1');

    expect(taskId).toBe('task-existing');
    expect(finalizeSpy).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'task-existing',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        title: 'Already completed activation',
      }),
      'completed',
      client,
    );
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('bypasses the batching delay for follow-on activation dispatch after completion', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("AND activation_id = $3") && sql.includes("state = 'processing'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        if (sql.includes('FROM tasks') && sql.includes('activation_id = $3') && sql.includes('id <> $5::uuid')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SET state = \'completed\'')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1', 'Reviewed workflow state']);
          return {
            rowCount: 2,
            rows: [
              {
                id: 'activation-1',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                request_id: 'req-1',
                reason: 'work_item.created',
                event_type: 'work_item.created',
                payload: {},
                state: 'completed',
                queued_at: new Date('2026-03-11T00:00:00Z'),
                started_at: new Date('2026-03-11T00:00:10Z'),
                consumed_at: new Date('2026-03-11T00:01:00Z'),
                completed_at: new Date('2026-03-11T00:01:00Z'),
                summary: 'Reviewed workflow state',
                error: null,
              },
              {
                id: 'activation-2',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                request_id: 'req-2',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: {},
                state: 'completed',
                queued_at: new Date('2026-03-11T00:00:05Z'),
                started_at: new Date('2026-03-11T00:00:10Z'),
                consumed_at: new Date('2026-03-11T00:01:00Z'),
                completed_at: new Date('2026-03-11T00:01:00Z'),
                summary: 'Reviewed workflow state',
                error: null,
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('activation_id IS NULL')) {
          return { rowCount: 1, rows: [{ id: 'activation-3' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi.spyOn(service, 'dispatchActivation').mockResolvedValue('task-next');

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        output: { summary: 'Reviewed workflow state' },
      },
      'completed',
      client as never,
    );

    expect(dispatchSpy).toHaveBeenCalledWith('tenant-1', 'activation-3', client, {
      ignoreDelay: true,
    });
  });

  it('prioritizes queued workflow events ahead of heartbeat rows for follow-on dispatch after completion', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("AND activation_id = $3") && sql.includes("state = 'processing'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        if (sql.includes('FROM tasks') && sql.includes('activation_id = $3') && sql.includes('id <> $5::uuid')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SET state = \'completed\'')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'activation-1',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                request_id: 'req-1',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: {},
                state: 'completed',
                queued_at: new Date('2026-03-11T00:00:00Z'),
                started_at: new Date('2026-03-11T00:00:10Z'),
                consumed_at: new Date('2026-03-11T00:01:00Z'),
                completed_at: new Date('2026-03-11T00:01:00Z'),
                summary: 'Reviewed workflow state',
                error: null,
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('activation_id IS NULL')) {
          expect(sql).toContain("CASE WHEN event_type = 'heartbeat' THEN 1 ELSE 0 END");
          return { rowCount: 1, rows: [{ id: 'activation-real-event' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi.spyOn(service, 'dispatchActivation').mockResolvedValue('task-next');

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        output: { summary: 'Reviewed workflow state' },
      },
      'completed',
      client as never,
    );

    expect(dispatchSpy).toHaveBeenCalledWith('tenant-1', 'activation-real-event', client, {
      ignoreDelay: true,
    });
  });

  it('skips duplicate completion callbacks after an activation was already finalized', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("AND activation_id = $3") && sql.includes("state = 'processing'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi.spyOn(service, 'dispatchActivation').mockResolvedValue('task-next');

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        output: { summary: 'Already handled' },
      },
      'completed',
      client as never,
    );

    expect(eventService.emit).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('skips duplicate failure callbacks after an activation was already finalized', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("AND activation_id = $3") && sql.includes("state = 'processing'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi.spyOn(service, 'dispatchActivation').mockResolvedValue('task-next');

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        error: { message: 'Already handled' },
      },
      'failed',
      client as never,
    );

    expect(eventService.emit).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('immediately retries the next queued activation after a failed orchestrator activation requeues the batch', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("AND activation_id = $3") && sql.includes("state = 'processing'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        if (sql.includes('FROM tasks') && sql.includes('activation_id = $3') && sql.includes('id <> $5::uuid')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SET state = \'queued\'')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            'Orchestrator activation failed',
            { message: 'Orchestrator activation failed' },
          ]);
          return {
            rowCount: 2,
            rows: [
              {
                id: 'activation-1',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: null,
                request_id: 'req-1',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: {},
                state: 'queued',
                queued_at: new Date('2026-03-11T00:00:00Z'),
                started_at: null,
                consumed_at: null,
                completed_at: null,
                summary: 'Orchestrator activation failed',
                error: { message: 'Orchestrator activation failed' },
              },
              {
                id: 'activation-2',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: null,
                request_id: 'req-2',
                reason: 'work_item.updated',
                event_type: 'work_item.updated',
                payload: {},
                state: 'queued',
                queued_at: new Date('2026-03-11T00:00:05Z'),
                started_at: null,
                consumed_at: null,
                completed_at: null,
                summary: 'Orchestrator activation failed',
                error: { message: 'Orchestrator activation failed' },
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('activation_id IS NULL')) {
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi.spyOn(service, 'dispatchActivation').mockResolvedValue('task-retry');

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
      },
      'failed',
      client as never,
    );

    expect(dispatchSpy).toHaveBeenCalledWith('tenant-1', 'activation-1', client, {
      ignoreDelay: true,
    });
  });

  it('ignores stale completion callbacks when a replacement orchestrator task is already active', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("AND activation_id = $3") && sql.includes("state = 'processing'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        if (sql.includes('FROM tasks') && sql.includes('activation_id = $3') && sql.includes('id <> $5::uuid')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_review'],
            'task-old',
          ]);
          return { rowCount: 1, rows: [{ '?column?': 1 }] };
        }
        if (sql.includes('SET state = \'completed\'')) {
          throw new Error('completion update should not run for stale callbacks');
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi.spyOn(service, 'dispatchActivation').mockResolvedValue('task-next');

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-old',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        output: { summary: 'Late callback from stale task' },
      },
      'completed',
      client as never,
    );

    expect(eventService.emit).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

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
              ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_review'],
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
              ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_review'],
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

  it('ignores completion from a stale orchestrator dispatch attempt', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id') && sql.includes('dispatch_attempt = $4')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1', 1]);
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        metadata: {
          activation_dispatch_attempt: 1,
        },
        output: { summary: 'stale completion' },
      },
      'completed',
      client as never,
    );

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('ignores completion from a stale orchestrator dispatch token', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id') && sql.includes('dispatch_attempt = $4') && sql.includes('dispatch_token = $5::uuid')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            2,
            'a36e63b2-6d00-44d4-8cf1-d5721a1d3f8e',
          ]);
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        metadata: {
          activation_dispatch_attempt: 2,
          activation_dispatch_token: 'a36e63b2-6d00-44d4-8cf1-d5721a1d3f8e',
        },
        output: { summary: 'stale completion' },
      },
      'completed',
      client as never,
    );

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('falls back to the dispatch-attempt guard when the task metadata token is redacted', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id') && sql.includes('dispatch_attempt = $4') && !sql.includes('dispatch_token =')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            2,
          ]);
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        metadata: {
          activation_dispatch_attempt: 2,
          activation_dispatch_token: 'redacted://task-secret',
        },
        output: { summary: 'stale completion' },
      },
      'completed',
      client as never,
    );

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('falls back to the task request_id dispatch attempt when activation metadata is missing', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id') && sql.includes('dispatch_attempt = $4') && !sql.includes('dispatch_token =')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            1,
          ]);
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        request_id: 'activation:activation-1:dispatch:1',
        is_orchestrator_task: true,
        output: { summary: 'stale completion' },
      },
      'completed',
      client as never,
    );

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('finalizes completion when the orchestrator dispatch token matches the live activation', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id') && sql.includes('dispatch_attempt = $4') && sql.includes('dispatch_token = $5::uuid')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            2,
            'a36e63b2-6d00-44d4-8cf1-d5721a1d3f8e',
          ]);
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        if (sql.includes('FROM tasks') && sql.includes('activation_id = $3') && sql.includes('id <> $5::uuid')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_review'],
            'task-1',
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SET state = \'completed\'')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1', 'Reviewed workflow state']);
          return {
            rowCount: 1,
            rows: [
              {
                id: 'activation-1',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                request_id: 'req-1',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: {},
                state: 'completed',
                dispatch_attempt: 2,
                dispatch_token: null,
                queued_at: new Date('2026-03-11T00:00:00Z'),
                started_at: new Date('2026-03-11T00:00:10Z'),
                consumed_at: new Date('2026-03-11T00:01:00Z'),
                completed_at: new Date('2026-03-11T00:01:00Z'),
                summary: 'Reviewed workflow state',
                error: null,
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('activation_id IS NULL')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        metadata: {
          activation_dispatch_attempt: 2,
          activation_dispatch_token: 'a36e63b2-6d00-44d4-8cf1-d5721a1d3f8e',
        },
        output: { summary: 'Reviewed workflow state' },
      },
      'completed',
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_completed',
        entityId: 'workflow-1',
        data: expect.objectContaining({
          activation_id: 'activation-1',
          task_id: 'task-1',
          event_count: 1,
        }),
      }),
      client,
    );
  });

  it('uses the runtime-aligned orchestrator tool contract when dispatching activation tasks', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-tools',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-tools',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-1', work_item_id: 'wi-1', stage_name: 'review' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-15T01:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              project_id: 'project-1',
              lifecycle: 'planned',
              current_stage: 'review',
              active_stages: ['review'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
              project_repository_url: null,
              project_settings: null,
              workflow_git_branch: null,
              workflow_parameters: null,
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-tools',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-tools',
              request_id: 'req-tools',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-1', work_item_id: 'wi-1', stage_name: 'review' },
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-tools',
              queued_at: new Date('2026-03-15T01:00:00Z'),
              started_at: new Date('2026-03-15T01:00:05Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          expect(params?.[8]).toEqual(
            expect.objectContaining({
              tools: expect.arrayContaining([
                'list_work_items',
                'list_workflow_tasks',
                'read_task_output',
                'read_task_status',
                'read_task_events',
                'read_escalation',
                'read_stage_status',
                'read_workflow_budget',
                'read_work_item_continuity',
                'read_latest_handoff',
                'read_handoff_chain',
                'update_task_input',
                'cancel_task',
                'reassign_task',
                'work_item_memory_read',
                'work_item_memory_history',
                'artifact_document_read',
                'send_task_message',
              ]),
            }),
          );
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('web_search');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('advance_stage');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('approve_task');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('approve_task_output');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('request_rework');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('request_task_changes');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('escalate_to_human');
          return { rowCount: 1, rows: [{ id: 'task-tools' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-tools');

    expect(taskId).toBe('task-tools');
  });
});
