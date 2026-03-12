import { describe, expect, it, vi } from 'vitest';

import { PlaybookTaskParallelismService } from '../../src/services/playbook-task-parallelism-service.js';

describe('PlaybookTaskParallelismService', () => {
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

  it('promotes queued approval tasks into awaiting_approval when capacity becomes available', async () => {
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
            rows: [{
              id: 'task-approval-1',
              work_item_id: 'wi-1',
              state: 'pending',
              requires_approval: true,
            }],
          };
        }
        if (sql.includes('GROUP BY work_item_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SET state = $3')) {
          expect(values).toEqual(['tenant-1', 'task-approval-1', 'awaiting_approval']);
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
        entityId: 'task-approval-1',
        data: expect.objectContaining({
          from_state: 'pending',
          to_state: 'awaiting_approval',
          reason: 'parallelism_slot_available',
        }),
      }),
      client,
    );
  });
});
