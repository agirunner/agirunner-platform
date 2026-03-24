import { describe, expect, it, vi } from 'vitest';

import { PlaybookTaskParallelismService } from '../../src/services/playbook-task-parallelism-service.js';

describe('PlaybookTaskParallelismService', () => {
  it('does not count output_pending_assessment tasks as active specialist slots', async () => {
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                board: { columns: [{ id: 'todo', label: 'Todo' }] },
                stages: [{ name: 'review', goal: 'Review it' }],
                orchestrator: {
                  max_active_tasks: 2,
                  max_active_tasks_per_work_item: 1,
                  allow_parallel_work_items: false,
                },
              },
            }],
          };
        }
        if (sql.includes('GROUP BY work_item_id')) {
          expect(values?.[2]).toEqual(['ready', 'claimed', 'in_progress', 'awaiting_approval']);
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new PlaybookTaskParallelismService(pool as never);
    const blocked = await service.shouldQueueForCapacity('tenant-1', {
      workflowId: 'wf-1',
      workItemId: 'wi-review',
      isOrchestratorTask: false,
    });

    expect(blocked).toBe(false);
  });

  it('queues specialist tasks when the workflow cap is full', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                board: { columns: [{ id: 'todo', label: 'Todo' }] },
                stages: [{ name: 'build', goal: 'Build it' }],
                orchestrator: { max_active_tasks: 1 },
              },
            }],
          };
        }
        if (sql.includes('GROUP BY work_item_id')) {
          return { rowCount: 1, rows: [{ work_item_id: 'wi-1', total: '1' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new PlaybookTaskParallelismService(pool as never);
    const blocked = await service.shouldQueueForCapacity('tenant-1', {
      workflowId: 'wf-1',
      workItemId: 'wi-2',
      isOrchestratorTask: false,
    });

    expect(blocked).toBe(true);
  });

  it('promotes pending tasks when capacity becomes available', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                board: { columns: [{ id: 'todo', label: 'Todo' }] },
                stages: [{ name: 'build', goal: 'Build it' }],
                orchestrator: { max_active_tasks: 2, max_active_tasks_per_work_item: 1 },
              },
            }],
          };
        }
        if (sql.includes("t.state = 'pending'")) {
          return {
            rowCount: 1,
            rows: [{ id: 'task-1', work_item_id: 'wi-1', state: 'pending' }],
          };
        }
        if (sql.includes('GROUP BY work_item_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SET state = $3')) {
          expect(values).toEqual(['tenant-1', 'task-1', 'ready']);
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new PlaybookTaskParallelismService({ query: vi.fn() } as never);
    const promoted = await service.releaseQueuedReadyTasks(
      eventService as never,
      'tenant-1',
      'wf-1',
      client as never,
    );

    expect(promoted).toBe(1);
    expect(eventService.emit).toHaveBeenCalledTimes(1);
  });

  it('promotes queued tasks directly into ready when capacity becomes available', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                board: { columns: [{ id: 'todo', label: 'Todo' }] },
                stages: [{ name: 'build', goal: 'Build it' }],
                orchestrator: { max_active_tasks: 2, max_active_tasks_per_work_item: 1 },
              },
            }],
          };
        }
        if (sql.includes("t.state = 'pending'")) {
          expect(sql).not.toContain('requires_approval');
          return {
            rowCount: 1,
            rows: [{
              id: 'task-ready-1',
              work_item_id: 'wi-1',
              state: 'pending',
            }],
          };
        }
        if (sql.includes('GROUP BY work_item_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SET state = $3')) {
          expect(values).toEqual(['tenant-1', 'task-ready-1', 'ready']);
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new PlaybookTaskParallelismService({ query: vi.fn() } as never);
    const promoted = await service.releaseQueuedReadyTasks(
      eventService as never,
      'tenant-1',
      'wf-1',
      client as never,
    );

    expect(promoted).toBe(1);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'task-ready-1',
        data: expect.objectContaining({
          from_state: 'pending',
          to_state: 'ready',
          reason: 'parallelism_slot_available',
        }),
      }),
      client,
    );
  });

  it('requeues a lower-precedence ready task so an older retried task can reclaim the freed slot', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const retriedCreatedAt = new Date('2026-03-12T12:00:00.000Z');
    const readyCreatedAt = new Date('2026-03-12T12:10:00.000Z');
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                board: { columns: [{ id: 'todo', label: 'Todo' }] },
                stages: [{ name: 'build', goal: 'Build it' }],
                orchestrator: { max_active_tasks: 2, max_active_tasks_per_work_item: 1 },
              },
            }],
          };
        }
        if (sql.includes('GROUP BY work_item_id')) {
          return {
            rowCount: 2,
            rows: [
              { work_item_id: 'wi-a', total: '1' },
              { work_item_id: 'wi-c', total: '1' },
            ],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-b1',
              work_item_id: 'wi-b',
              priority: 'normal',
              created_at: retriedCreatedAt,
            }],
          };
        }
        if (sql.includes("AND state = 'ready'") && sql.includes('id <> $3::uuid')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-c1',
              work_item_id: 'wi-c',
              priority: 'normal',
              created_at: readyCreatedAt,
            }],
          };
        }
        if (sql.includes("SET state = 'pending'")) {
          expect(values).toEqual(['tenant-1', 'task-c1']);
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new PlaybookTaskParallelismService({ query: vi.fn() } as never);
    const reclaimed = await service.reclaimReadySlotForTask(
      eventService as never,
      'tenant-1',
      {
        taskId: 'task-b1',
        workflowId: 'wf-1',
        workItemId: 'wi-b',
        isOrchestratorTask: false,
        currentState: 'failed',
      },
      client as never,
    );

    expect(reclaimed).toBe(true);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'task-c1',
        data: expect.objectContaining({
          from_state: 'ready',
          to_state: 'pending',
          reason: 'parallelism_retry_fairness_requeue',
          reclaimed_by_task_id: 'task-b1',
        }),
      }),
      client,
    );
  });

  it('does not requeue an older ready task for a younger retry candidate', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const retriedCreatedAt = new Date('2026-03-12T12:10:00.000Z');
    const readyCreatedAt = new Date('2026-03-12T12:00:00.000Z');
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                board: { columns: [{ id: 'todo', label: 'Todo' }] },
                stages: [{ name: 'build', goal: 'Build it' }],
                orchestrator: { max_active_tasks: 2, max_active_tasks_per_work_item: 1 },
              },
            }],
          };
        }
        if (sql.includes('GROUP BY work_item_id')) {
          return {
            rowCount: 2,
            rows: [
              { work_item_id: 'wi-a', total: '1' },
              { work_item_id: 'wi-c', total: '1' },
            ],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-b1',
              work_item_id: 'wi-b',
              priority: 'normal',
              created_at: retriedCreatedAt,
            }],
          };
        }
        if (sql.includes("AND state = 'ready'") && sql.includes('id <> $3::uuid')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-c1',
              work_item_id: 'wi-c',
              priority: 'normal',
              created_at: readyCreatedAt,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new PlaybookTaskParallelismService({ query: vi.fn() } as never);
    const reclaimed = await service.reclaimReadySlotForTask(
      eventService as never,
      'tenant-1',
      {
        taskId: 'task-b1',
        workflowId: 'wf-1',
        workItemId: 'wi-b',
        isOrchestratorTask: false,
        currentState: 'failed',
      },
      client as never,
    );

    expect(reclaimed).toBe(false);
    expect(eventService.emit).not.toHaveBeenCalled();
  });
});
