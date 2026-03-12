import { describe, expect, it, vi } from 'vitest';

import { WorkflowActivationDispatchService } from '../../src/services/workflow-activation-dispatch-service.js';

describe('WorkflowActivationDispatchService', () => {
  it('dispatches queued activations with a bounded workflow batch and counts only created orchestrator tasks', async () => {
    const pool = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => {
        expect(params).toEqual([
          ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_review'],
          60_000,
          2,
        ]);
        return {
          rowCount: 2,
          rows: [
            { id: 'activation-1', tenant_id: 'tenant-1', workflow_id: 'workflow-1' },
            { id: 'activation-2', tenant_id: 'tenant-1', workflow_id: 'workflow-2' },
          ],
        };
      }),
      connect: vi.fn(),
    };
    const service = new WorkflowActivationDispatchService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi
      .spyOn(service, 'dispatchActivation')
      .mockResolvedValueOnce('task-1')
      .mockResolvedValueOnce(null);

    const dispatched = await service.dispatchQueuedActivations(2);

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(dispatchSpy).toHaveBeenNthCalledWith(1, 'tenant-1', 'activation-1');
    expect(dispatchSpy).toHaveBeenNthCalledWith(2, 'tenant-1', 'activation-2');
    expect(dispatched).toBe(1);
  });

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

  it('dispatches a large queued activation batch into a single orchestrator task', async () => {
    const activationRows = Array.from({ length: 200 }, (_, index) => ({
      id: `activation-${index + 1}`,
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      activation_id: 'activation-1',
      request_id: `req-${index + 1}`,
      reason: index === 0 ? 'work_item.created' : 'task.completed',
      event_type: index === 0 ? 'work_item.created' : 'task.completed',
      payload:
        index === 0
          ? { work_item_id: 'wi-root' }
          : { task_id: `task-${index}`, work_item_id: `wi-${index}`, stage_name: 'implementation' },
      state: index === 0 ? 'processing' : 'queued',
      queued_at: new Date(`2026-03-11T00:00:${String(index % 60).padStart(2, '0')}Z`),
      started_at: new Date('2026-03-11T00:02:00Z'),
      consumed_at: null,
      completed_at: null,
      summary: null,
      error: null,
    }));

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [activationRows[0]],
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
            rowCount: activationRows.length,
            rows: activationRows,
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          expect(params?.[5]).toBe('implementation');
          expect(params?.[6]).toEqual(
            expect.objectContaining({
              activation_id: 'activation-1',
              activation_reason: 'queued_events',
              active_stages: ['implementation'],
              events: expect.arrayContaining([
                expect.objectContaining({ queue_id: 'activation-1', type: 'work_item.created' }),
                expect.objectContaining({ queue_id: 'activation-200', type: 'task.completed' }),
              ]),
            }),
          );
          expect((params?.[6] as { events: unknown[] }).events).toHaveLength(200);
          return { rowCount: 1, rows: [{ id: 'task-batched' }] };
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

    expect(taskId).toBe('task-batched');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tasks'),
      expect.any(Array),
    );
    expect(
      client.query.mock.calls.filter(([sql]) => String(sql).includes('SET activation_id = $3')),
    ).toHaveLength(1);
    expect(
      client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO tasks')),
    ).toHaveLength(1);
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

  it('reuses an existing orchestrator activation task on insert replay without emitting duplicate events', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true') && sql.includes("state = ANY")) {
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
          return {
            rowCount: 1,
            rows: [{
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
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          expect(sql).toContain('ON CONFLICT (tenant_id, workflow_id, request_id)');
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('request_id = $3') && sql.includes('is_orchestrator_task = true')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation:activation-1']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-existing',
              state: 'ready',
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              is_orchestrator_task: true,
              title: 'Orchestrate Workflow One: work_item.created',
              output: null,
              error: null,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-1');

    expect(taskId).toBe('task-existing');
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('reactivates a failed existing orchestrator activation task with refreshed batched input', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true') && sql.includes('state = ANY')) {
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
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('request_id = $3') && sql.includes('is_orchestrator_task = true')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation:activation-1']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-existing',
              state: 'failed',
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              is_orchestrator_task: true,
              title: 'Orchestrate Workflow One: work_item.created',
              output: { summary: 'old output' },
              error: { message: 'old failure' },
            }],
          };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          expect(params).toEqual([
            'tenant-1',
            'task-existing',
            'Orchestrate Workflow One: work_item.created',
            'implementation',
            expect.objectContaining({
              activation_id: 'activation-1',
              activation_reason: 'queued_events',
              active_stages: ['implementation'],
              events: [
                expect.objectContaining({ queue_id: 'activation-1', type: 'work_item.created' }),
                expect.objectContaining({ queue_id: 'activation-2', type: 'task.completed' }),
              ],
            }),
            expect.any(Object),
            { execution_mode: 'orchestrator' },
            expect.objectContaining({ activation_event_count: 2 }),
            'activation-1',
          ]);
          return { rowCount: 1, rows: [{ id: 'task-existing' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-1');

    expect(taskId).toBe('task-existing');
    expect(eventService.emit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'task-existing',
        data: expect.objectContaining({
          previous_state: 'failed',
          state: 'ready',
          reason: 'activation_redispatched',
          activation_id: 'activation-1',
        }),
      }),
      client,
    );
    expect(eventService.emit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'workflow.activation_started',
        data: expect.objectContaining({
          activation_id: 'activation-1',
          event_count: 2,
          task_id: 'task-existing',
        }),
      }),
      client,
    );
  });

  it('finalizes a completed existing activation task on insert replay instead of leaving the activation stuck', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string) => {
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
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-9' },
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true') && sql.includes('state = ANY')) {
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
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              request_id: 'req-1',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-9' },
              state: 'processing',
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: new Date('2026-03-11T00:00:10Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('request_id = $3') && sql.includes('is_orchestrator_task = true')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-existing',
              state: 'completed',
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              is_orchestrator_task: true,
              title: 'Already completed activation',
              output: { summary: 'already completed' },
              error: null,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const finalizeSpy = vi.spyOn(service, 'finalizeActivationForTask').mockResolvedValue(undefined);

    const taskId = await service.dispatchActivation('tenant-1', 'activation-1');

    expect(taskId).toBe('task-existing');
    expect(finalizeSpy).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'task-existing',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        title: 'Already completed activation',
      }),
      'completed',
      client,
    );
    expect(eventService.emit).not.toHaveBeenCalled();
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
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_review'],
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

  it('does not emit duplicate stale-detected events once the same stuck task was already reported', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations wa') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-9',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-8',
              activation_id: 'activation-9',
              request_id: 'req-9',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-9' },
              state: 'processing',
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: new Date('2026-03-11T00:02:00Z'),
              consumed_at: null,
              completed_at: null,
              summary: 'Stale orchestrator detected during activation recovery',
              error: {
                recovery: {
                  status: 'stale_detected',
                  reason: 'orchestrator_task_still_active',
                  task_id: 'task-active',
                },
              },
              active_task_id: 'task-active',
            }],
          };
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
            return { rowCount: 1, rows: [{ id: 'activation-9', tenant_id: 'tenant-1' }] };
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
      reported: 0,
      details: [],
    });
    expect(eventService.emit).not.toHaveBeenCalled();
  });
});
