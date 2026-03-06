import { describe, expect, it, vi } from 'vitest';

import { TaskLifecycleService } from '../../src/services/task-lifecycle-service.js';

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
      // First read inside transition sees claimed state.
      .mockResolvedValueOnce({
        id: 'task-1',
        state: 'claimed',
        pipeline_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
      })
      // Second read after update miss sees that cancellation won the race.
      .mockResolvedValueOnce({
        id: 'task-1',
        state: 'cancelled',
        pipeline_id: null,
        assigned_agent_id: null,
        assigned_worker_id: null,
      });

    const eventService = { emit: vi.fn() };
    const pipelineStateService = { recomputePipelineState: vi.fn() };

    const service = new TaskLifecycleService({
      pool: pool as never,
      eventService: eventService as never,
      pipelineStateService: pipelineStateService as never,
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
      /INVALID_STATE_TRANSITION|Task state changed concurrently|Cannot transition from 'cancelled' to 'running'/,
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

describe('TaskLifecycleService worker identity + payload semantics', () => {
  it('allows worker identity to complete assigned running task', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-worker',
                state: 'completed',
                pipeline_id: null,
                assigned_agent_id: null,
                assigned_worker_id: null,
                metrics: { duration_seconds: 4 },
                git_info: { commit_hash: 'abc123' },
                metadata: { verification: { passed: true } },
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      pipelineStateService: { recomputePipelineState: vi.fn() } as never,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-worker',
        state: 'running',
        pipeline_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: 'worker-1',
        role_config: {},
      }),
      toTaskResponse: (task) => task,
    });

    const result = await service.completeTask(
      {
        id: 'worker-key',
        tenantId: 'tenant-1',
        scope: 'worker',
        ownerType: 'worker',
        ownerId: 'worker-1',
        keyPrefix: 'wk',
      },
      'task-worker',
      {
        output: { ok: true },
        metrics: { duration_seconds: 4 },
        git_info: { commit_hash: 'abc123' },
        verification: { passed: true },
      },
    );

    expect(result.state).toBe('completed');
    expect(result.metrics).toMatchObject({ duration_seconds: 4 });
  });

  it('moves completion to output_pending_review when output schema validation fails', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-review',
                state: 'output_pending_review',
                pipeline_id: null,
                assigned_agent_id: null,
                assigned_worker_id: null,
                output: { missing: true },
                metadata: { verification: { passed: true } },
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      pipelineStateService: { recomputePipelineState: vi.fn() } as never,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-review',
        state: 'running',
        pipeline_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role_config: {
          output_schema: {
            type: 'object',
            required: ['summary'],
            properties: { summary: { type: 'string' } },
          },
        },
      }),
      toTaskResponse: (task) => task,
    });

    const result = await service.completeTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-review',
      {
        output: { missing: true },
        verification: { passed: true },
      },
    );

    expect(result.state).toBe('output_pending_review');
  });

  it('queues cancel signal for running worker task before cancellation transition', async () => {
    const queueWorkerCancelSignal = vi.fn(async () => 'signal-1');

    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-cancel',
                state: 'cancelled',
                assigned_agent_id: null,
                assigned_worker_id: null,
                pipeline_id: null,
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      pipelineStateService: { recomputePipelineState: vi.fn() } as never,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-cancel',
        state: 'running',
        assigned_worker_id: 'worker-1',
      }),
      toTaskResponse: (task) => task,
      queueWorkerCancelSignal,
    });

    const result = await service.cancelTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-cancel',
    );

    expect(result.state).toBe('cancelled');
    expect(queueWorkerCancelSignal).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'worker-1',
      'task-cancel',
      'manual_cancel',
      expect.any(Date),
    );
  });

  it('records review metadata when requesting task changes', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-review-loop',
                state: 'ready',
                pipeline_id: null,
                input: { review_feedback: 'Fix the failing assertions' },
                metadata: { review_action: 'request_changes', preferred_agent_id: 'agent-2' },
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      pipelineStateService: { recomputePipelineState: vi.fn() } as never,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-review-loop',
        state: 'output_pending_review',
        pipeline_id: null,
        input: { summary: 'old output' },
        metadata: {},
      }),
      toTaskResponse: (task) => task,
    });

    const result = await service.requestTaskChanges(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-review-loop',
      {
        feedback: 'Fix the failing assertions',
        preferred_agent_id: 'agent-2',
      },
    );

    expect(result.state).toBe('ready');
    expect(result.input).toMatchObject({ review_feedback: 'Fix the failing assertions' });
    expect(result.metadata).toMatchObject({
      review_action: 'request_changes',
      preferred_agent_id: 'agent-2',
    });
    const updateCall = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE tasks SET')) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ review_feedback: 'Fix the failing assertions' }),
        expect.objectContaining({ review_action: 'request_changes', preferred_agent_id: 'agent-2' }),
      ]),
    );
  });

  it('queues cancel signal before reassigning a running task', async () => {
    const queueWorkerCancelSignal = vi.fn(async () => 'signal-2');
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-reassign',
                state: 'ready',
                pipeline_id: null,
                metadata: { preferred_worker_id: 'worker-3', review_action: 'reassign' },
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      pipelineStateService: { recomputePipelineState: vi.fn() } as never,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-reassign',
        state: 'running',
        pipeline_id: null,
        assigned_worker_id: 'worker-2',
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      queueWorkerCancelSignal,
    });

    const result = await service.reassignTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-reassign',
      {
        preferred_worker_id: 'worker-3',
        reason: 'Move to a healthier worker',
      },
    );

    expect(result.state).toBe('ready');
    expect(result.metadata).toMatchObject({
      preferred_worker_id: 'worker-3',
      review_action: 'reassign',
    });
    expect(queueWorkerCancelSignal).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'worker-2',
      'task-reassign',
      'manual_cancel',
      expect.any(Date),
    );
    const updateCall = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE tasks SET')) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ preferred_worker_id: 'worker-3', review_action: 'reassign' }),
      ]),
    );
  });
});
