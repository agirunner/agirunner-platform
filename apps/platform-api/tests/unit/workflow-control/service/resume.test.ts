import { describe, expect, it, vi } from 'vitest';

import { ConflictError } from '../../../../src/errors/domain-errors.js';
import { createPool, createService, identity } from './support.js';

describe('WorkflowControlService resumeWorkflow', () => {
  it('resumes paused workflows by clearing the pause marker before recomputing state', async () => {
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
              metadata: {
                pause_requested_at: '2026-03-12T00:00:00.000Z',
                pause_reopen_task_ids: [],
              },
            }],
          };
        }
        if (sql.startsWith('UPDATE tasks t') && sql.includes("t.id = ANY($3::uuid[])")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_work_items')) {
          return { rowCount: 1, rows: [] };
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
    const pool = createPool(client);
    const eventService = { emit: vi.fn() };
    const stateService = { recomputeWorkflowState: vi.fn(async () => 'active') };
    const service = createService({
      pool: pool as never,
      eventService,
      stateService,
    });

    const result = await service.resumeWorkflow(identity, 'workflow-1');

    expect(result).toEqual({ id: 'workflow-1', state: 'active' });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("metadata = ((COALESCE(metadata, '{}'::jsonb) - 'pause_requested_at') - 'pause_reopen_task_ids')"),
      ['tenant-1', 'workflow-1'],
    );
    const workflowUpdateSql = client.query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.startsWith('UPDATE workflows') &&
        String(sql).includes("metadata = ((COALESCE(metadata, '{}'::jsonb) - 'pause_requested_at') - 'pause_reopen_task_ids')"),
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

  it('reopens pause-cancelled specialist delivery tasks from the current pause window before resuming', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT id, state, metadata FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              state: 'paused',
              metadata: {
                pause_requested_at: '2026-03-12T00:00:00.000Z',
                pause_reopen_task_ids: ['task-reopened-after-resume'],
              },
            }],
          };
        }
        if (
          sql.startsWith('UPDATE tasks')
          && sql.includes("SET state = 'ready'")
          && sql.includes("t.id = ANY($3::uuid[])")
        ) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            ['task-reopened-after-resume'],
          ]);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-reopened-after-resume',
              state: 'ready',
              work_item_id: 'work-item-1',
            }],
          };
        }
        if (sql.startsWith('UPDATE workflows')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE workflow_work_items')) {
          return { rowCount: 2, rows: [] };
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
    const pool = createPool(client);
    const eventService = { emit: vi.fn() };
    const stateService = { recomputeWorkflowState: vi.fn(async () => 'active') };
    const service = createService({
      pool: pool as never,
      eventService,
      stateService,
    });

    const result = await service.resumeWorkflow(identity, 'workflow-1');

    expect(result).toEqual({ id: 'workflow-1', state: 'active' });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('t.id = ANY($3::uuid[])'),
      ['tenant-1', 'workflow-1', ['task-reopened-after-resume']],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1'],
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'task-reopened-after-resume',
        data: expect.objectContaining({
          from_state: 'cancelled',
          to_state: 'ready',
          reason: 'workflow_resumed',
        }),
      }),
      client,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workflow.resumed', data: { state: 'active' } }),
      client,
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
    const pool = createPool(client);
    const service = createService({
      pool: pool as never,
      eventService: { emit: vi.fn() },
      stateService: { recomputeWorkflowState: vi.fn() },
    });

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
    const pool = createPool(client);
    const service = createService({
      pool: pool as never,
      eventService: { emit: vi.fn() },
      stateService: { recomputeWorkflowState: vi.fn() },
    });

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
    const pool = createPool(client);
    const service = createService({
      pool: pool as never,
      eventService: { emit: vi.fn() },
      stateService: { recomputeWorkflowState: vi.fn() },
    });

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
    const pool = createPool(client);
    const eventService = { emit: vi.fn() };
    const stateService = { recomputeWorkflowState: vi.fn(async () => 'active') };
    const service = createService({
      pool: pool as never,
      eventService,
      stateService,
    });

    const result = await service.resumeWorkflow(identity, 'workflow-1');

    expect(result).toEqual({ id: 'workflow-1', state: 'active' });
    expect(stateService.recomputeWorkflowState).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalled();
  });
});
