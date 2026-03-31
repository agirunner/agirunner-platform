import { describe, expect, it, vi } from 'vitest';

import { expectWorkflowStageProjection, WorkflowActivationDispatchService } from './test-harness.js';

describe('WorkflowActivationDispatchService', () => {
  it('dispatches actionable task activations immediately without waiting for the batching delay', async () => {
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
              id: 'activation-9',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-9',
              reason: 'task.approved',
              event_type: 'task.approved',
              payload: {
                task_id: 'task-9',
                task_role: 'reviewer',
                stage_name: 'review',
                work_item_id: 'work-item-9',
              },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
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
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              workspace_id: 'workspace-1',
              lifecycle: 'planned',
              current_stage: 'review',
              active_stages: ['review'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
              workspace_repository_url: null,
              workspace_settings: null,
              workflow_git_branch: null,
              workflow_parameters: null,
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-9',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-9',
              request_id: 'req-9',
              reason: 'task.approved',
              event_type: 'task.approved',
              payload: {
                task_id: 'task-9',
                task_role: 'reviewer',
                stage_name: 'review',
                work_item_id: 'work-item-9',
              },
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-9',
              queued_at: new Date(Date.now() - 5_000),
              started_at: new Date(),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          const input = params?.[7] as Record<string, unknown>;
          expect(input).toEqual(
            expect.objectContaining({
              activation_reason: 'queued_events',
              description: expect.any(String),
              events: [
                expect.objectContaining({
                  type: 'task.approved',
                  reason: 'task.approved',
                  work_item_id: 'work-item-9',
                }),
              ],
            }),
          );
          expect(String(input.description)).toContain('Primary trigger event: task.approved.');
          expect(String(input.description)).toContain(
            'Primary trigger details: task.approved (task_id=task-9, task_role=reviewer, stage_name=review, work_item_id=work-item-9).',
          );
          return { rowCount: 1, rows: [{ id: 'task-approved-dispatch' }] };
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
    expectWorkflowStageProjection({ currentStage: 'review', activeStages: ['review'] });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-9');

    expect(taskId).toBe('task-approved-dispatch');
  });

  it('does not piggyback fresh non-immediate activations into an immediate activation batch', async () => {
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
              id: 'activation-11',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-11',
              reason: 'task.approved',
              event_type: 'task.approved',
              payload: { task_id: 'task-11', work_item_id: 'work-item-11' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
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
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              workspace_id: 'workspace-1',
              lifecycle: 'planned',
              current_stage: 'review',
              active_stages: ['review'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
              workspace_repository_url: null,
              workspace_settings: null,
              workflow_git_branch: null,
              workflow_parameters: null,
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          expect(sql).toContain("queued_at <= now() - ($5 * interval '1 millisecond')");
          expect(params?.[4]).toBe(60_000);
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-11',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-11',
              request_id: 'req-11',
              reason: 'task.approved',
              event_type: 'task.approved',
              payload: { task_id: 'task-11', work_item_id: 'work-item-11' },
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-11',
              queued_at: new Date(Date.now() - 5_000),
              started_at: new Date(),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          expect(params?.[7]).toEqual(
            expect.objectContaining({
              events: [
                expect.objectContaining({
                  type: 'task.approved',
                  reason: 'task.approved',
                }),
              ],
            }),
          );
          return { rowCount: 1, rows: [{ id: 'task-immediate-only' }] };
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
    expectWorkflowStageProjection({ currentStage: 'review', activeStages: ['review'] });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-11');

    expect(taskId).toBe('task-immediate-only');
  });

  it('defers non-immediate activations until the batching delay elapses', async () => {
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
              id: 'activation-10',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-10',
              reason: 'manual.audit_requested',
              event_type: 'manual.audit_requested',
              payload: { note: 'batch me' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
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

    const taskId = await service.dispatchActivation('tenant-1', 'activation-10');

    expect(taskId).toBeNull();
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO tasks'), expect.anything());
  });
});
