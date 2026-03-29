import { describe, expect, it, vi } from 'vitest';

import { ConflictError } from '../../src/errors/domain-errors.js';
import { WorkflowCancellationService } from '../../src/services/workflow-cancellation-service.js';

const identity = {
  id: 'admin',
  tenantId: 'tenant-1',
  scope: 'admin' as const,
  ownerType: 'user',
  ownerId: null,
  keyPrefix: 'admin',
};

describe('WorkflowCancellationService', () => {
  it('rejects cancellation before the workflow has entered an active or paused run state', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'pending',
              metadata: {},
              lifecycle: 'planned',
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowCancellationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'pending') } as never,
      resolveCancelSignalGracePeriodMs: async () => 60_000,
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'pending' })),
    });

    await expect(service.cancelWorkflow(identity as never, 'workflow-1')).rejects.toThrow(
      'Only active or paused workflows can be cancelled',
    );
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('treats a repeated cancellation request as idempotent once cancel_requested_at is present', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'paused',
              metadata: {
                cancel_requested_at: '2026-03-12T00:00:00.000Z',
                cancel_force_at: '2026-03-12T00:01:00.000Z',
              },
              lifecycle: 'planned',
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const getWorkflow = vi.fn(async () => ({ id: 'workflow-1', state: 'paused' }));
    const eventService = { emit: vi.fn() };
    const stateService = { recomputeWorkflowState: vi.fn() };
    const service = new WorkflowCancellationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      stateService: stateService as never,
      resolveCancelSignalGracePeriodMs: async () => 60_000,
      getWorkflow,
    });

    const result = await service.cancelWorkflow(identity as never, 'workflow-1');
    const workflowSql = String(client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('FROM workflows'))?.[0] ?? '');

    expect(result).toEqual({ id: 'workflow-1', state: 'paused' });
    expect(workflowSql).toBe('SELECT id, state, metadata, lifecycle FROM workflows WHERE tenant_id = $1 AND id = $2 FOR UPDATE');
    expect(getWorkflow).toHaveBeenCalledWith('tenant-1', 'workflow-1');
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(stateService.recomputeWorkflowState).not.toHaveBeenCalled();
  });

  it('uses canonical in_progress task state when selecting active tasks for workflow cancellation', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'active',
              metadata: {},
              lifecycle: 'planned',
            }],
          };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_stage_gates')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_stages')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_activations')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE execution_container_leases')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflows')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE agents')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowCancellationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'paused') } as never,
      resolveCancelSignalGracePeriodMs: async () => 60_000,
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'paused' })),
    });

    const result = await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(result).toEqual(expect.objectContaining({ id: 'workflow-1', state: 'paused' }));
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("state = ANY($3::task_state[])"),
      ['tenant-1', 'workflow-1', ['claimed', 'in_progress']],
    );
  });

  it('cancels active workflow tasks immediately, clears ownership, releases leases, and drains specialist runtimes', async () => {
    const workerConnectionHub = { sendToWorker: vi.fn() };
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'active',
              metadata: {},
              lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: 'task-specialist-1',
                state: 'in_progress',
                assigned_worker_id: 'worker-1',
                is_orchestrator_task: false,
              },
              {
                id: 'task-orchestrator-1',
                state: 'claimed',
                assigned_worker_id: null,
                is_orchestrator_task: true,
              },
            ],
          };
        }
        if (sql.startsWith('INSERT INTO worker_signals')) {
          return {
            rowCount: 1,
            rows: [{ id: 'signal-1', created_at: new Date('2026-03-12T00:00:00.000Z') }],
          };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return {
            rowCount: 2,
            rows: [
              { id: 'task-specialist-1', is_orchestrator_task: false },
              { id: 'task-orchestrator-1', is_orchestrator_task: true },
            ],
          };
        }
        if (sql.startsWith('UPDATE workflow_stage_gates')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_stages')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE execution_container_leases')) {
          return { rowCount: 1, rows: [] };
        }
        if (
          sql.startsWith('UPDATE runtime_heartbeats')
          && sql.includes('SET task_id = NULL')
        ) {
          return { rowCount: 2, rows: [] };
        }
        if (sql.startsWith('UPDATE runtime_heartbeats')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_activations')) {
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        if (sql.startsWith('UPDATE workflows')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE agents')) {
          return { rowCount: 2, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowCancellationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'cancelled') } as never,
      resolveCancelSignalGracePeriodMs: async () => 60_000,
      workerConnectionHub: workerConnectionHub as never,
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'cancelled' })),
    });

    await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'cancelled'"),
      expect.arrayContaining(['tenant-1', 'workflow-1']),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE execution_container_leases'),
      ['tenant-1', 'workflow-1'],
    );
    const workerSignalCalls = client.query.mock.calls.filter(
      ([sql]) => String(sql).startsWith('INSERT INTO worker_signals'),
    );
    expect(workerSignalCalls).toHaveLength(1);
    expect(workerSignalCalls[0]?.[0]).toContain("'set_draining'");
    expect(workerSignalCalls[0]?.[1]).toEqual([
      'tenant-1',
      'worker-1',
      {
        reason: 'workflow_stopped',
        workflow_id: 'workflow-1',
      },
    ]);
    expect(workerConnectionHub.sendToWorker).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        task_id: null,
        signal_type: 'set_draining',
        data: {
          reason: 'workflow_stopped',
          workflow_id: 'workflow-1',
        },
      }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'worker.signaled',
        entityId: 'worker-1',
      }),
      client,
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE runtime_heartbeats'),
      ['tenant-1', ['task-specialist-1']],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SET task_id = NULL'),
      ['tenant-1', ['task-specialist-1', 'task-orchestrator-1']],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agents'),
      ['tenant-1', ['task-specialist-1', 'task-orchestrator-1']],
    );
  });

  it('allows paused workflows to transition into cancellation and stop any remaining workflow-bound execution', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'paused',
              metadata: { pause_requested_at: '2026-03-12T00:00:00.000Z' },
              lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_stage_gates')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_stages')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE execution_container_leases')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_activations')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflows')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE agents')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowCancellationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'cancelled') } as never,
      resolveCancelSignalGracePeriodMs: async () => 60_000,
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'cancelled' })),
    });

    const result = await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(result).toEqual(expect.objectContaining({ id: 'workflow-1', state: 'cancelled' }));
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflows'),
      expect.arrayContaining([
        'tenant-1',
        'workflow-1',
        expect.objectContaining({ cancel_requested_at: expect.any(String) }),
      ]),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workflow.cancellation_requested' }),
      client,
    );
  });

  it('clears the pause marker when a paused workflow is cancelled', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'paused',
              metadata: { pause_requested_at: '2026-03-12T00:00:00.000Z' },
              lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_stage_gates')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_stages')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE execution_container_leases')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_activations')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflows')) {
          expect(sql).toContain("COALESCE(metadata, '{}'::jsonb) - 'pause_requested_at'");
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            expect.objectContaining({ cancel_requested_at: expect.any(String) }),
          ]);
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE agents')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowCancellationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'cancelled') } as never,
      resolveCancelSignalGracePeriodMs: async () => 60_000,
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'cancelled' })),
    });

    const result = await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(result).toEqual(expect.objectContaining({ id: 'workflow-1', state: 'cancelled' }));
  });

  it('closes pending stage gates when workflow cancellation is requested', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'active',
              metadata: {},
              lifecycle: 'planned',
            }],
          };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_stage_gates')) {
          return { rowCount: 2, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_stages')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_activations')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE execution_container_leases')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflows')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE agents')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowCancellationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'paused') } as never,
      resolveCancelSignalGracePeriodMs: async () => 60_000,
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'paused' })),
    });

    await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_stage_gates'),
      ['tenant-1', 'workflow-1', 'admin', 'admin'],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_stages'),
      ['tenant-1', 'workflow-1'],
    );
  });

  it('marks queued workflow activations as failed when a workflow is cancelled', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'active',
              metadata: {},
              lifecycle: 'planned',
            }],
          };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_stage_gates')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_stages')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_activations')) {
          expect(sql).toContain("SET state = 'failed'");
          expect(sql).toContain("state IN ('queued', 'processing')");
          expect(params).toEqual(['tenant-1', 'workflow-1', 'Workflow cancelled by operator.']);
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        if (sql.startsWith('UPDATE execution_container_leases')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflows')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE agents')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowCancellationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'cancelled') } as never,
      resolveCancelSignalGracePeriodMs: async () => 60_000,
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'cancelled' })),
    });

    await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'failed'"),
      ['tenant-1', 'workflow-1', 'Workflow cancelled by operator.'],
    );
  });

  it('does not persist blocked stage status for continuous workflow cancellation', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'active',
              metadata: {},
              lifecycle: 'ongoing',
            }],
          };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_stage_gates')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_stages')) {
          expect(sql).not.toMatch(/\bstatus\s*=\s*CASE/);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_activations')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE execution_container_leases')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflows')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE agents')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowCancellationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'paused') } as never,
      resolveCancelSignalGracePeriodMs: async () => 60_000,
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'paused' })),
    });

    await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_stages'),
      ['tenant-1', 'workflow-1'],
    );
  });

  it('cancels escalated tasks immediately during workflow cancellation', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'active',
              metadata: {},
              lifecycle: 'planned',
            }],
          };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return { rowCount: 1, rows: [{ id: 'task-1' }] };
        }
        if (sql.startsWith('UPDATE workflow_stage_gates')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_stages')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_activations')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE execution_container_leases')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflows')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE agents')) {
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowCancellationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'cancelled') } as never,
      resolveCancelSignalGracePeriodMs: async () => 60_000,
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'cancelled' })),
    });

    await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("state = ANY($3::task_state[])"),
      [
        'tenant-1',
        'workflow-1',
        [
          'pending',
          'ready',
          'claimed',
          'in_progress',
          'awaiting_approval',
          'output_pending_assessment',
          'failed',
          'escalated',
        ],
      ],
    );
  });

  it('still rejects cancellation for terminal workflows', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata, lifecycle FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{ id: 'workflow-1', state: 'cancelled', metadata: {}, lifecycle: 'planned' }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowCancellationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      stateService: { recomputeWorkflowState: vi.fn() } as never,
      resolveCancelSignalGracePeriodMs: async () => 60_000,
      getWorkflow: vi.fn(),
    });

    await expect(service.cancelWorkflow(identity as never, 'workflow-1')).rejects.toBeInstanceOf(ConflictError);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
