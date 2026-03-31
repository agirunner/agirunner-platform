import { describe, expect, it, vi } from 'vitest';

import { WorkflowActivationDispatchService } from './test-harness.js';

describe('WorkflowActivationDispatchService', () => {
  it('bypasses the batching delay for immediate follow-on activation dispatch after completion', async () => {
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

  it('does not bypass the batching delay for non-immediate follow-on activation dispatch after completion', async () => {
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
          return {
            rowCount: 1,
            rows: [
              {
                id: 'activation-1',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                request_id: 'req-1',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: {},
                state: 'completed',
                queued_at: new Date('2026-03-11T00:00:00Z'),
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
          expect(sql).toContain("queued_at <= now() - ($3 * interval '1 millisecond')");
          expect(params).toEqual(['tenant-1', 'workflow-1', 60_000]);
          return { rowCount: 0, rows: [] };
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

    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('finalizes an escalated orchestrator activation as completed workflow activity', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("AND activation_id = $3") && sql.includes("state = 'processing'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        if (sql.includes('FROM tasks') && sql.includes('activation_id = $3') && sql.includes('id <> $5::uuid')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("SET state = 'completed'")) {
          return {
            rowCount: 1,
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
                summary: 'Operator intervention required',
                error: null,
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('activation_id IS NULL')) {
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

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        metadata: {
          escalation_reason: 'Operator intervention required',
        },
      },
      'escalated',
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_completed',
        data: expect.objectContaining({
          activation_id: 'activation-1',
          task_id: 'task-1',
        }),
      }),
      client,
    );
  });

  it('prioritizes queued workflow events ahead of heartbeat rows for follow-on dispatch after completion', async () => {
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
          return {
            rowCount: 1,
            rows: [
              {
                id: 'activation-1',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                request_id: 'req-1',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: {},
                state: 'completed',
                queued_at: new Date('2026-03-11T00:00:00Z'),
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
          expect(sql).toContain("CASE WHEN event_type = 'heartbeat' THEN 1 ELSE 0 END");
          return { rowCount: 1, rows: [{ id: 'activation-real-event' }] };
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

    expect(dispatchSpy).toHaveBeenCalledWith('tenant-1', 'activation-real-event', client, {
      ignoreDelay: true,
    });
  });

  it('finalizes an existing escalated activation task instead of reactivating it', async () => {
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
    const internalService = service as unknown as {
      reactivateExistingActivationTask: (...args: unknown[]) => unknown;
      resolveExistingActivationTask: (...args: unknown[]) => Promise<unknown>;
    };
    const reactivationSpy = vi.spyOn(internalService, 'reactivateExistingActivationTask');
    const dispatchSpy = vi.spyOn(service, 'dispatchActivation').mockResolvedValue(null);
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('request_id = $3') && sql.includes('is_orchestrator_task = true')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation:activation-1:dispatch:1']);
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-escalated',
                state: 'escalated',
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                is_orchestrator_task: true,
                title: 'Approval gate orchestrator',
                metadata: { escalation_reason: 'Operator intervention required' },
                output: null,
                error: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT id') && sql.includes("state = 'processing'")) {
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        if (sql.includes('FROM tasks') && sql.includes('activation_id = $3') && sql.includes('id <> $5::uuid')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("SET state = 'completed'")) {
          return {
            rowCount: 1,
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
                summary: 'Operator intervention required',
                error: null,
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('activation_id IS NULL')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const resolution = await internalService.resolveExistingActivationTask(
      'tenant-1',
      'workflow-1',
      'activation-2',
      'activation:activation-1:dispatch:1',
      {} as never,
      {} as never,
      client as never,
    );

    expect(resolution).toEqual({ kind: 'finalized', taskId: 'task-escalated' });
    expect(reactivationSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
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
});
