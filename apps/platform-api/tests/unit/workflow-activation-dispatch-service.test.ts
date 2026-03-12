import { describe, expect, it, vi } from 'vitest';

import { WorkflowActivationDispatchService } from '../../src/services/workflow-activation-dispatch-service.js';

describe('WorkflowActivationDispatchService', () => {
  it('dispatches an idle work item activation immediately into a batched orchestrator task', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
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
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              project_id: 'project-1',
              lifecycle: 'continuous',
              current_stage: null,
              active_stages: ['implementation'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
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
          expect(params?.[6]).toEqual(
            expect.objectContaining({
              activation_id: 'activation-1',
              activation_reason: 'queued_events',
              current_stage: null,
              active_stages: ['implementation'],
              events: [
                expect.objectContaining({ queue_id: 'activation-1', type: 'work_item.created' }),
                expect.objectContaining({ queue_id: 'activation-2', type: 'task.completed' }),
              ],
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

  it('defers non-immediate activations until the batching delay elapses', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
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
            ['pending', 'ready', 'claimed', 'running', 'awaiting_approval', 'output_pending_review'],
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
        if (sql === 'BEGIN' || sql === 'COMMIT') {
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

  it('records stale orchestrator detections without requeueing when the task is still active', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
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
        query: vi.fn(async (sql: string) => {
          if (sql.includes('SELECT wa.id, wa.tenant_id')) {
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
});
