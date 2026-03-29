import { describe, expect, it, vi } from 'vitest';

import { stopWorkflowBoundExecution } from '../../src/services/workflow-execution-stop-service.js';

describe('stopWorkflowBoundExecution', () => {
  it('queues an immediate drain signal for active specialist workers when workflow-bound execution is stopped', async () => {
    const workerConnectionHub = { sendToWorker: vi.fn() };
    const eventService = { emit: vi.fn(async () => undefined) };
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_worker_id')) {
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
          const signalType = params?.[2];
          return {
            rowCount: 1,
            rows: [{
              id: `${String(signalType)}-signal-1`,
              created_at: new Date('2026-03-29T19:00:00.000Z'),
            }],
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
        if (
          sql.startsWith('UPDATE execution_container_leases')
          || sql.startsWith('UPDATE runtime_heartbeats')
          || sql.startsWith('UPDATE workflow_activations')
          || sql.startsWith('UPDATE agents')
        ) {
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    await stopWorkflowBoundExecution(
      db as never,
      {
        eventService: eventService as never,
        resolveCancelSignalGracePeriodMs: async () => 1_500,
        workerConnectionHub: workerConnectionHub as never,
      },
      {
        tenantId: 'tenant-1',
        workflowId: 'workflow-1',
        summary: 'Workflow paused by operator.',
        signalReason: 'manual_pause',
        actorType: 'admin',
        actorId: 'admin-key',
      },
    );

    const insertCalls = db.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.startsWith('INSERT INTO worker_signals'),
    );

    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0]?.[0]).toContain("'cancel_task'");
    expect(insertCalls[0]?.[1]).toEqual([
      'tenant-1',
      'worker-1',
      'task-specialist-1',
      expect.objectContaining({
        reason: 'manual_pause',
        grace_period_ms: 1_500,
      }),
    ]);
    expect(insertCalls[1]?.[0]).toContain("'set_draining'");
    expect(insertCalls[1]?.[1]).toEqual([
      'tenant-1',
      'worker-1',
      {
        reason: 'workflow_stopped',
        workflow_id: 'workflow-1',
      },
    ]);
    expect(workerConnectionHub.sendToWorker).toHaveBeenNthCalledWith(
      1,
      'worker-1',
      expect.objectContaining({
        signal_type: 'cancel_task',
        task_id: 'task-specialist-1',
      }),
    );
    expect(workerConnectionHub.sendToWorker).toHaveBeenNthCalledWith(
      2,
      'worker-1',
      expect.objectContaining({
        signal_type: 'set_draining',
        task_id: null,
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
        data: { signal_type: 'set_draining', task_id: null },
      }),
      db,
    );
  });

  it('moves affected specialist work items back to their entry column when pause/cancel stops the only active execution', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_worker_id')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-specialist-1',
                state: 'in_progress',
                assigned_worker_id: 'worker-1',
                is_orchestrator_task: false,
              },
            ],
          };
        }
        if (sql.startsWith('INSERT INTO worker_signals')) {
          return {
            rowCount: 1,
            rows: [{ id: 'signal-1', created_at: new Date('2026-03-29T19:00:00.000Z') }],
          };
        }
        if (sql.startsWith('UPDATE tasks')) {
          expect(sql).toContain('RETURNING id, is_orchestrator_task, work_item_id');
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-specialist-1',
                is_orchestrator_task: false,
                work_item_id: 'work-item-1',
              },
            ],
          };
        }
        if (
          sql.startsWith('UPDATE execution_container_leases')
          || sql.startsWith('UPDATE runtime_heartbeats')
          || sql.startsWith('UPDATE workflow_activations')
          || sql.startsWith('UPDATE agents')
        ) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [
              {
                workflow_id: 'workflow-1',
                work_item_id: 'work-item-1',
                stage_name: 'delegated-synthesis',
                column_id: 'active',
                completed_at: null,
                blocked_state: null,
                escalation_status: null,
                definition: {
                  board: {
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'active', label: 'In Progress' },
                      { id: 'blocked', label: 'Blocked', is_blocked: true },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  roles: [],
                  stages: [],
                },
              },
            ],
          };
        }
        if (sql.includes('COUNT(*)::int AS active_specialist_task_count')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return { rowCount: 1, rows: [{ active_specialist_task_count: 0 }] };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes('SET column_id = $4')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1', 'planned']);
          return { rowCount: 1, rows: [{ id: 'work-item-1' }] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    await stopWorkflowBoundExecution(
      db as never,
      {
        eventService: eventService as never,
        resolveCancelSignalGracePeriodMs: async () => 1_500,
      },
      {
        tenantId: 'tenant-1',
        workflowId: 'workflow-1',
        summary: 'Workflow paused by operator.',
        signalReason: 'manual_pause',
        actorType: 'admin',
        actorId: 'admin-key',
      },
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.moved',
        entityId: 'work-item-1',
        data: expect.objectContaining({
          previous_column_id: 'active',
          column_id: 'planned',
          workflow_id: 'workflow-1',
        }),
      }),
      db,
    );
  });
});
