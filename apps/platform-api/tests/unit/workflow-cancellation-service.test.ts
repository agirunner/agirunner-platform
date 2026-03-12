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
  it('treats a repeated cancellation request as idempotent once cancel_requested_at is present', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT * FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'paused',
              metadata: {
                cancel_requested_at: '2026-03-12T00:00:00.000Z',
                cancel_force_at: '2026-03-12T00:01:00.000Z',
              },
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
      cancelSignalGracePeriodMs: 60_000,
      getWorkflow,
    });

    const result = await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(result).toEqual({ id: 'workflow-1', state: 'paused' });
    expect(getWorkflow).toHaveBeenCalledWith('tenant-1', 'workflow-1');
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(stateService.recomputeWorkflowState).not.toHaveBeenCalled();
  });

  it('uses canonical in_progress task state when selecting active tasks for workflow cancellation', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT * FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'active',
              metadata: {},
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
        if (sql.startsWith('UPDATE workflow_activations')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("state IN ('claimed', 'in_progress')")) {
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
      cancelSignalGracePeriodMs: 60_000,
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'paused' })),
    });

    const result = await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(result).toEqual(expect.objectContaining({ id: 'workflow-1', state: 'paused' }));
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("state IN ('claimed', 'in_progress')"),
      ['tenant-1', 'workflow-1'],
    );
  });

  it('closes pending stage gates when workflow cancellation is requested', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT * FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'active',
              metadata: {},
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
        if (sql.startsWith('UPDATE workflow_activations')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("state IN ('claimed', 'in_progress')")) {
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
      cancelSignalGracePeriodMs: 60_000,
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

  it('cancels escalated tasks immediately during workflow cancellation', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT * FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'active',
              metadata: {},
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
        if (sql.startsWith('UPDATE workflow_activations')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("state IN ('claimed', 'in_progress')")) {
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
      cancelSignalGracePeriodMs: 60_000,
      getWorkflow: vi.fn(async () => ({ id: 'workflow-1', state: 'cancelled' })),
    });

    await service.cancelWorkflow(identity as never, 'workflow-1');

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("state = ANY($3::task_state[])"),
      ['tenant-1', 'workflow-1', ['pending', 'ready', 'awaiting_approval', 'output_pending_review', 'failed', 'escalated']],
    );
  });

  it('still rejects cancellation for terminal workflows', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT * FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{ id: 'workflow-1', state: 'cancelled', metadata: {} }],
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
      cancelSignalGracePeriodMs: 60_000,
      getWorkflow: vi.fn(),
    });

    await expect(service.cancelWorkflow(identity as never, 'workflow-1')).rejects.toBeInstanceOf(ConflictError);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
