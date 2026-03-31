import { describe, expect, it, vi } from 'vitest';

import {
  expectWorkflowStageProjection,
  readInsertedActivationTask,
  WorkflowActivationDispatchService,
} from './test-harness.js';

describe('WorkflowActivationDispatchService', () => {
  it('completes heartbeat-only activations without dispatch when specialist work is still running', async () => {
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
              id: 'activation-heartbeat',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'heartbeat:workflow-1:5911344',
              reason: 'heartbeat',
              event_type: 'heartbeat',
              payload: {},
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-13T12:00:00Z'),
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
              workspace_id: 'workspace-1',
              lifecycle: 'ongoing',
              current_stage: null,
              active_stages: ['triage'],
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
              id: 'activation-heartbeat',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-heartbeat',
              request_id: 'heartbeat:workflow-1:5911344',
              reason: 'heartbeat',
              event_type: 'heartbeat',
              payload: {},
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-heartbeat',
              queued_at: new Date('2026-03-13T12:00:00Z'),
              started_at: new Date('2026-03-13T12:00:05Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = false')) {
          return { rowCount: 1, rows: [{ '?column?': 1 }] };
        }
        if (sql.includes("SET state = 'completed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-heartbeat',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-heartbeat',
              request_id: 'heartbeat:workflow-1:5911344',
              reason: 'heartbeat',
              event_type: 'heartbeat',
              payload: {},
              state: 'completed',
              dispatch_attempt: 1,
              dispatch_token: null,
              queued_at: new Date('2026-03-13T12:00:00Z'),
              started_at: new Date('2026-03-13T12:00:05Z'),
              consumed_at: new Date('2026-03-13T12:00:05Z'),
              completed_at: new Date('2026-03-13T12:00:05Z'),
              summary: 'heartbeat skipped while specialist work is still in progress',
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          throw new Error('heartbeat should not dispatch orchestrator task while specialist work is active');
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
    expectWorkflowStageProjection({ activeStages: ['triage'] });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-heartbeat');

    expect(taskId).toBeNull();
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_completed',
        data: expect.objectContaining({
          activation_id: 'activation-heartbeat',
          event_type: 'heartbeat',
          reason: 'heartbeat',
          task_id: null,
          event_count: 0,
          summary: 'heartbeat skipped while specialist work is still in progress',
        }),
      }),
      client,
    );
  });

  it('treats heartbeat-anchor batches with queued events as queued-event activations', async () => {
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
              id: 'activation-heartbeat',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'heartbeat:workflow-1:5911344',
              reason: 'heartbeat',
              event_type: 'heartbeat',
              payload: {},
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-13T12:00:00Z'),
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
                id: 'activation-heartbeat',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-heartbeat',
                request_id: 'heartbeat:workflow-1:5911344',
                reason: 'heartbeat',
                event_type: 'heartbeat',
                payload: {},
                state: 'processing',
                dispatch_attempt: 1,
                dispatch_token: 'dispatch-token-heartbeat',
                queued_at: new Date('2026-03-13T12:00:00Z'),
                started_at: new Date('2026-03-13T12:00:05Z'),
                consumed_at: null,
                completed_at: null,
                summary: null,
                error: null,
              },
              {
                id: 'activation-task-completed',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-heartbeat',
                request_id: 'req-task-completed',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: { task_id: 'task-9', work_item_id: 'wi-9', stage_name: 'implementation' },
                state: 'queued',
                dispatch_attempt: 1,
                dispatch_token: 'dispatch-token-heartbeat',
                queued_at: new Date('2026-03-13T12:00:06Z'),
                started_at: new Date('2026-03-13T12:00:05Z'),
                consumed_at: null,
                completed_at: null,
                summary: null,
                error: null,
              },
            ],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          const inserted = readInsertedActivationTask(params);
          expect(inserted.workItemId).toBe('wi-9');
          expect(inserted.input).toEqual(
            expect.objectContaining({
              activation_id: 'activation-heartbeat',
              activation_reason: 'queued_events',
              events: [
                expect.objectContaining({
                  queue_id: 'activation-task-completed',
                  type: 'task.completed',
                }),
              ],
            }),
          );
          expect(inserted.maxIterations).toBe(500);
          expect(inserted.llmMaxRetries).toBe(5);
          expect(inserted.metadata).toEqual(
            expect.objectContaining({
              activation_event_type: 'task.completed',
              activation_reason: 'queued_events',
              activation_event_count: 1,
            }),
          );
          return { rowCount: 1, rows: [{ id: 'task-mixed' }] };
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

    const taskId = await service.dispatchActivation('tenant-1', 'activation-heartbeat');

    expect(taskId).toBe('task-mixed');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_started',
        data: expect.objectContaining({
          activation_id: 'activation-heartbeat',
          event_type: 'task.completed',
          reason: 'queued_events',
          event_count: 1,
          task_id: 'task-mixed',
        }),
      }),
      client,
    );
  });
});
