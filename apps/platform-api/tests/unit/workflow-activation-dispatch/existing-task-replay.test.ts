import { describe, expect, it, vi } from 'vitest';

import {
  expectWorkflowStageProjection,
  WorkflowActivationDispatchService,
} from './test-harness.js';

describe('WorkflowActivationDispatchService', () => {
  it('reuses an existing orchestrator activation task on insert replay without emitting duplicate events', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
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
              dispatch_attempt: 0,
              dispatch_token: null,
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
              workspace_id: 'workspace-1',
              lifecycle: 'ongoing',
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
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-1',
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation:activation-1:dispatch:1']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-existing',
              state: 'ready',
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              is_orchestrator_task: true,
              title: 'Orchestrate Workflow One',
              metadata: { activation_dispatch_attempt: 1 },
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
    expectWorkflowStageProjection({ activeStages: ['implementation'] });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-1');

    expect(taskId).toBe('task-existing');
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('reactivates a failed existing orchestrator activation task with refreshed batched input', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
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
              dispatch_attempt: 0,
              dispatch_token: null,
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
              workspace_id: 'workspace-1',
              lifecycle: 'ongoing',
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
                dispatch_attempt: 1,
                dispatch_token: 'dispatch-token-1',
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
                dispatch_attempt: 1,
                dispatch_token: 'dispatch-token-1',
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation:activation-1:dispatch:1']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-existing',
              state: 'failed',
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              is_orchestrator_task: true,
              title: 'Orchestrate Workflow One',
              metadata: { activation_dispatch_attempt: 1 },
              output: { summary: 'old output' },
              error: { message: 'old failure' },
            }],
          };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          expect(params?.[0]).toBe('tenant-1');
          expect(params?.[1]).toBe('task-existing');
          expect(params?.[2]).toBe('Orchestrate Workflow One');
          expect(params?.[3]).toBe('implementation');
          expect(params?.[4]).toBe('wi-1');
          expect(params?.[5]).toEqual(
            expect.objectContaining({
              activation_id: 'activation-1',
              activation_reason: 'queued_events',
              activation_dispatch_attempt: 1,
              activation_dispatch_token: 'dispatch-token-1',
              active_stages: ['implementation'],
              events: [
                expect.objectContaining({ queue_id: 'activation-1', type: 'work_item.created' }),
                expect.objectContaining({ queue_id: 'activation-2', type: 'task.completed' }),
              ],
            }),
          );
          expect(params?.[6]).toEqual(expect.any(Object));
          expect(params?.[7]).toEqual({ execution_mode: 'orchestrator' });
          expect(params?.[8]).toBe('[]');
          expect(params?.[9]).toEqual(
            expect.objectContaining({
              activation_event_count: 2,
              activation_dispatch_attempt: 1,
              activation_dispatch_token: 'dispatch-token-1',
              activation_event_type: 'work_item.created',
              activation_reason: 'queued_events',
              activation_request_id: 'req-1',
            }),
          );
          expect(params?.[10]).toBe(500);
          expect(params?.[11]).toBe(5);
          expect(params?.[12]).toBe('activation-1');
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
    expectWorkflowStageProjection({ activeStages: ['implementation'] });

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
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
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
              workspace_id: 'workspace-1',
              lifecycle: 'ongoing',
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
    expectWorkflowStageProjection({ activeStages: ['implementation'] });
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
});
