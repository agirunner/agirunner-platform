import { describe, expect, it, vi } from 'vitest';

import { expectWorkflowStageProjection, WorkflowActivationDispatchService } from './test-harness.js';

describe('WorkflowActivationDispatchService', () => {
  it('ignores completion from a stale orchestrator dispatch attempt', async () => {
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
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id') && sql.includes('dispatch_attempt = $4')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1', 1]);
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        metadata: {
          activation_dispatch_attempt: 1,
        },
        output: { summary: 'stale completion' },
      },
      'completed',
      client as never,
    );

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('ignores completion from a stale orchestrator dispatch token', async () => {
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
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id') && sql.includes('dispatch_attempt = $4') && sql.includes('dispatch_token = $5::uuid')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            2,
            'a36e63b2-6d00-44d4-8cf1-d5721a1d3f8e',
          ]);
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        metadata: {
          activation_dispatch_attempt: 2,
          activation_dispatch_token: 'a36e63b2-6d00-44d4-8cf1-d5721a1d3f8e',
        },
        output: { summary: 'stale completion' },
      },
      'completed',
      client as never,
    );

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('falls back to the dispatch-attempt guard when the task metadata token is redacted', async () => {
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
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id') && sql.includes('dispatch_attempt = $4') && !sql.includes('dispatch_token =')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            2,
          ]);
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        metadata: {
          activation_dispatch_attempt: 2,
          activation_dispatch_token: 'redacted://task-secret',
        },
        output: { summary: 'stale completion' },
      },
      'completed',
      client as never,
    );

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('falls back to the task request_id dispatch attempt when activation metadata is missing', async () => {
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
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id') && sql.includes('dispatch_attempt = $4') && !sql.includes('dispatch_token =')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            1,
          ]);
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        request_id: 'activation:activation-1:dispatch:1',
        is_orchestrator_task: true,
        output: { summary: 'stale completion' },
      },
      'completed',
      client as never,
    );

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('finalizes completion when the orchestrator dispatch token matches the live activation', async () => {
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
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id') && sql.includes('dispatch_attempt = $4') && sql.includes('dispatch_token = $5::uuid')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            2,
            'a36e63b2-6d00-44d4-8cf1-d5721a1d3f8e',
          ]);
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        if (sql.includes('FROM tasks') && sql.includes('activation_id = $3') && sql.includes('id <> $5::uuid')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment'],
            'task-1',
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SET state = \'completed\'')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1', 'Reviewed workflow state']);
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
                dispatch_attempt: 2,
                dispatch_token: null,
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
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        metadata: {
          activation_dispatch_attempt: 2,
          activation_dispatch_token: 'a36e63b2-6d00-44d4-8cf1-d5721a1d3f8e',
        },
        output: { summary: 'Reviewed workflow state' },
      },
      'completed',
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_completed',
        entityId: 'workflow-1',
        data: expect.objectContaining({
          activation_id: 'activation-1',
          task_id: 'task-1',
          event_count: 1,
        }),
      }),
      client,
    );
  });

  it('uses the runtime-aligned orchestrator tool contract when dispatching activation tasks', async () => {
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
              id: 'activation-tools',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-tools',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-1', work_item_id: 'wi-1', stage_name: 'review' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-15T01:00:00Z'),
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
              id: 'activation-tools',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-tools',
              request_id: 'req-tools',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-1', work_item_id: 'wi-1', stage_name: 'review' },
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-tools',
              queued_at: new Date('2026-03-15T01:00:00Z'),
              started_at: new Date('2026-03-15T01:00:05Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          expect(params?.[8]).toEqual(
            expect.objectContaining({
              tools: expect.arrayContaining([
                'list_work_items',
                'list_workflow_tasks',
                'read_task_output',
                'read_task_status',
                'read_task_events',
                'read_escalation',
                'read_stage_status',
                'read_workflow_budget',
                'read_work_item_continuity',
                'read_latest_handoff',
                'read_handoff_chain',
                'update_task_input',
                'cancel_task',
                'reassign_task',
                'work_item_memory_read',
                'work_item_memory_history',
                'artifact_document_read',
                'send_task_message',
                'record_operator_brief',
              ]),
            }),
          );
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('web_search');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('file_read');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('shell_exec');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('git_status');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('artifact_upload');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('web_fetch');
          expect((params?.[8] as Record<string, unknown>).tools).toContain('advance_stage');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('advance_checkpoint');
          expect((params?.[8] as Record<string, unknown>).tools).toContain('approve_task');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('approve_task_output');
          expect((params?.[8] as Record<string, unknown>).tools).toContain('request_rework');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('request_task_changes');
          expect((params?.[8] as Record<string, unknown>).tools).not.toContain('escalate_to_human');
          return { rowCount: 1, rows: [{ id: 'task-tools' }] };
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
    expectWorkflowStageProjection({ currentStage: 'review', activeStages: ['review'] });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-tools');

    expect(taskId).toBe('task-tools');
  });
});
