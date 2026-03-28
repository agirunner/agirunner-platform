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
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id, state, metadata FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{ id: 'workflow-1', state: 'active', metadata: {} }],
          };
        }
        if (sql.startsWith('UPDATE workflows')) {
          return {
            rowCount: 1,
            rows: [{ id: 'workflow-1', state: 'paused', metadata: { pause_requested_at: '2026-03-12T00:00:00.000Z' } }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn() };
    const service = new WorkflowControlService(
      pool as never,
      eventService as never,
      { recomputeWorkflowState: vi.fn() } as never,
    );

    const result = await service.pauseWorkflow(identity, 'workflow-1');

    expect(result.state).toBe('paused');
    expect(eventService.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.paused' }));
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb"),
      expect.arrayContaining(['tenant-1', 'workflow-1', expect.objectContaining({ pause_requested_at: expect.any(String) })]),
    );
  });

  it('treats a repeated pause request as idempotent once the workflow is already paused', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
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
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE workflows'), expect.anything());
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

    await expect(service.resumeWorkflow(identity, 'workflow-1')).rejects.toBeInstanceOf(ConflictError);
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
