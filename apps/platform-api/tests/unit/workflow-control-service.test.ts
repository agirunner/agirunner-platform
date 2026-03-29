import { describe, expect, it, vi } from 'vitest';

import { ConflictError } from '../../src/errors/domain-errors.js';
import { WorkflowControlService } from '../../src/services/workflow-control-service.js';

const identity = {
  id: 'admin',
  tenantId: 'tenant-1',
  scope: 'admin' as const,
  ownerType: 'user',
  ownerId: null,
  keyPrefix: 'admin',
};

describe('WorkflowControlService', () => {
  it('pauses active workflows and emits an audit event', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{ id: 'workflow-1', state: 'active', metadata: {} }],
          };
        }
        if (sql.includes('assigned_worker_id') && sql.includes('FROM tasks')) {
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
          return {
            rowCount: 1,
            rows: [{ id: 'workflow-1', state: 'paused', metadata: { pause_requested_at: '2026-03-12T00:00:00.000Z' } }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    };
    const eventService = { emit: vi.fn() };
    const service = new WorkflowControlService(
      pool as never,
      eventService as never,
      { recomputeWorkflowState: vi.fn() } as never,
    );

    const result = await service.pauseWorkflow(identity, 'workflow-1');

    expect(result.state).toBe('paused');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workflow.paused' }),
      client,
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb"),
      expect.arrayContaining(['tenant-1', 'workflow-1', expect.objectContaining({ pause_requested_at: expect.any(String) })]),
    );
  });

  it('pauses workflows by stopping active workflow-bound execution before marking the workflow paused', async () => {
    const workerConnectionHub = { sendToWorker: vi.fn() };
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{ id: 'workflow-1', state: 'active', metadata: {} }],
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
        if (sql.startsWith('UPDATE agents')) {
          return { rowCount: 2, rows: [] };
        }
        if (sql.startsWith('UPDATE workflows')) {
          return {
            rowCount: 1,
            rows: [{ id: 'workflow-1', state: 'paused', metadata: { pause_requested_at: '2026-03-12T00:00:00.000Z' } }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    };
    const eventService = { emit: vi.fn() };
    const service = new WorkflowControlService(
      pool as never,
      eventService as never,
      { recomputeWorkflowState: vi.fn() } as never,
      {
        resolveCancelSignalGracePeriodMs: async () => 1_500,
        workerConnectionHub: workerConnectionHub as never,
      },
    );

    await service.pauseWorkflow(identity, 'workflow-1');

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'cancelled'"),
      expect.arrayContaining(['tenant-1', 'workflow-1']),
    );
    const workerSignalCalls = client.query.mock.calls.filter(
      ([sql]) => String(sql).startsWith('INSERT INTO worker_signals'),
    );
    expect(workerSignalCalls).toHaveLength(2);
    expect(workerSignalCalls[0]?.[0]).toContain("'cancel_task'");
    expect(workerSignalCalls[0]?.[1]).toEqual([
      'tenant-1',
      'worker-1',
      'task-specialist-1',
      expect.objectContaining({
        reason: 'manual_pause',
        grace_period_ms: 1_500,
      }),
    ]);
    expect(workerSignalCalls[1]?.[0]).toContain("'set_draining'");
    expect(workerSignalCalls[1]?.[1]).toEqual([
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
        task_id: 'task-specialist-1',
        signal_type: 'cancel_task',
      }),
    );
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
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE execution_container_leases'),
      ['tenant-1', 'workflow-1'],
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
      expect.stringContaining('UPDATE workflow_activations'),
      ['tenant-1', 'workflow-1', 'Workflow paused by operator.'],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agents'),
      ['tenant-1', ['task-specialist-1', 'task-orchestrator-1']],
    );
  });

  it('treats a repeated pause request as idempotent once the workflow is already paused', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'paused',
              metadata: { pause_requested_at: '2026-03-12T00:00:00.000Z' },
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    };
    const eventService = { emit: vi.fn() };
    const service = new WorkflowControlService(
      pool as never,
      eventService as never,
      { recomputeWorkflowState: vi.fn() } as never,
    );

    const result = await service.pauseWorkflow(identity, 'workflow-1');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'workflow-1',
        state: 'paused',
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE workflows'), expect.anything());
  });

  it('rejects pause requests for workflows that are not actively in progress', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{ id: 'workflow-1', state: 'pending', metadata: {} }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    };
    const service = new WorkflowControlService(
      pool as never,
      { emit: vi.fn() } as never,
      { recomputeWorkflowState: vi.fn() } as never,
    );

    await expect(service.pauseWorkflow(identity, 'workflow-1')).rejects.toThrow(
      'Only active workflows can be paused',
    );
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('resumes paused workflows by clearing the pause marker before recomputing state', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1', state: 'paused', metadata: { pause_requested_at: '2026-03-12T00:00:00.000Z' } }] };
        }
        if (sql.startsWith('UPDATE workflows')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          return {
            rowCount: 1,
            rows: [{ id: 'activation-1', workflow_id: 'workflow-1', state: 'queued' }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    };
    const eventService = { emit: vi.fn() };
    const stateService = { recomputeWorkflowState: vi.fn(async () => 'active') };
    const service = new WorkflowControlService(
      pool as never,
      eventService as never,
      stateService as never,
    );

    const result = await service.resumeWorkflow(identity, 'workflow-1');

    expect(result).toEqual({ id: 'workflow-1', state: 'active' });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("metadata = COALESCE(metadata, '{}'::jsonb) - 'pause_requested_at'"),
      ['tenant-1', 'workflow-1'],
    );
    const workflowUpdateSql = client.query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.startsWith('UPDATE workflows') &&
        String(sql).includes("metadata = COALESCE(metadata, '{}'::jsonb) - 'pause_requested_at'"),
    )?.[0];
    expect(workflowUpdateSql).toBeDefined();
    expect(String(workflowUpdateSql)).not.toContain("SET state = 'pending'");
    expect(stateService.recomputeWorkflowState).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      client,
      expect.objectContaining({
        actorType: 'admin',
        actorId: 'admin',
      }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workflow.resumed', data: { state: 'active' } }),
      client,
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_activations'),
      expect.arrayContaining([
        'tenant-1',
        'workflow-1',
        'workflow-resume:workflow-1:2026-03-12T00:00:00.000Z',
        'workflow.resumed',
        'workflow.resumed',
      ]),
    );
  });

  it('rejects resume requests for workflows that are not paused', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1', state: 'active', metadata: { pause_requested_at: '2026-03-12T00:00:00.000Z' } }] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    };
    const service = new WorkflowControlService(
      pool as never,
      { emit: vi.fn() } as never,
      { recomputeWorkflowState: vi.fn() } as never,
    );

    await expect(service.resumeWorkflow(identity, 'workflow-1')).rejects.toBeInstanceOf(ConflictError);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('rejects resume requests for workflows that are cancelling even if their coarse state is paused', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'paused',
              metadata: { cancel_requested_at: '2026-03-12T00:00:00.000Z' },
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    };
    const service = new WorkflowControlService(
      pool as never,
      { emit: vi.fn() } as never,
      { recomputeWorkflowState: vi.fn() } as never,
    );

    await expect(service.resumeWorkflow(identity, 'workflow-1')).rejects.toBeInstanceOf(ConflictError);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('rejects resume requests for cancelled workflows', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{ id: 'workflow-1', state: 'cancelled', metadata: {} }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    };
    const service = new WorkflowControlService(
      pool as never,
      { emit: vi.fn() } as never,
      { recomputeWorkflowState: vi.fn() } as never,
    );

    await expect(service.resumeWorkflow(identity, 'workflow-1')).rejects.toThrow(
      'Cancelled workflows cannot be resumed',
    );
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('treats a repeated resume request as idempotent once the workflow is already active without a pause marker', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1', state: 'active', metadata: {} }] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    };
    const eventService = { emit: vi.fn() };
    const stateService = { recomputeWorkflowState: vi.fn(async () => 'active') };
    const service = new WorkflowControlService(
      pool as never,
      eventService as never,
      stateService as never,
    );

    const result = await service.resumeWorkflow(identity, 'workflow-1');

    expect(result).toEqual({ id: 'workflow-1', state: 'active' });
    expect(stateService.recomputeWorkflowState).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalled();
  });
});
