import { describe, expect, it, vi } from 'vitest';

import {
  expectWorkflowStageProjection,
  readInsertedActivationTask,
  WorkflowActivationDispatchService,
} from './test-harness.js';

describe('WorkflowActivationDispatchService', () => {
  it('uses work-item-driven active stages for continuous workflow dispatch input', async () => {
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
              payload: { work_item_id: 'wi-1', stage_name: 'triage' },
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).not.toContain('w.current_stage');
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
              id: 'activation-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              request_id: 'req-1',
              reason: 'work_item.created',
              event_type: 'work_item.created',
              payload: { work_item_id: 'wi-1', stage_name: 'triage' },
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
          expect(params?.[7]).toEqual(
            expect.objectContaining({
              activation_reason: 'queued_events',
              active_stages: ['triage'],
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
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    expectWorkflowStageProjection({ activeStages: ['triage'] });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-1');

    expect(taskId).toBe('task-1');
  });

  it('dispatches an idle work item activation immediately into a batched orchestrator task', async () => {
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).not.toContain('w.current_stage');
          expect(sql).toContain('p.definition AS playbook_definition');
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
              workspace_repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              workspace_settings: { default_branch: 'main' },
              workflow_git_branch: null,
              workflow_parameters: {
                branch: 'main',
                feature_branch: 'smoke/test/fix',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.com',
                git_token_secret_ref: 'secret:GITHUB_PAT',
              },
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          expect(params?.slice(0, 3)).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          expect(params?.[3]).toEqual(expect.any(String));
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
          const inserted = readInsertedActivationTask(params);
          expect(params?.[6]).toBe('implementation');
          expect(inserted.input).not.toHaveProperty('current_stage');
          expect(inserted.input).toEqual(
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
          expect(inserted.environment).toEqual(
            expect.objectContaining({
              execution_mode: 'orchestrator',
              template: 'execution-workspace',
              repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              branch: 'main',
            }),
          );
          expect(inserted.resourceBindings).toBe(JSON.stringify([]));
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
    expectWorkflowStageProjection({ activeStages: ['implementation'] });

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
      dispatch_attempt: 1,
      dispatch_token: 'dispatch-token-1',
      queued_at: new Date(`2026-03-11T00:00:${String(index % 60).padStart(2, '0')}Z`),
      started_at: new Date('2026-03-11T00:02:00Z'),
      consumed_at: null,
      completed_at: null,
      summary: null,
      error: null,
    }));

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
          expect(params?.slice(0, 3)).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          expect(params?.[3]).toEqual(expect.any(String));
          return {
            rowCount: activationRows.length,
            rows: activationRows,
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          expect(params?.[6]).toBe('implementation');
          expect(params?.[7]).toEqual(
            expect.objectContaining({
              activation_id: 'activation-1',
              activation_reason: 'queued_events',
              activation_dispatch_attempt: 1,
              activation_dispatch_token: 'dispatch-token-1',
              active_stages: ['implementation'],
              events: expect.arrayContaining([
                expect.objectContaining({ queue_id: 'activation-1', type: 'work_item.created' }),
                expect.objectContaining({ queue_id: 'activation-200', type: 'task.completed' }),
              ]),
            }),
          );
          expect((params?.[7] as { events: unknown[] }).events).toHaveLength(200);
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
    expectWorkflowStageProjection({ activeStages: ['implementation'] });

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

  it('aligns a planned activation to the primary event work item stage', async () => {
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
              id: 'activation-review-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-review-1',
              reason: 'task.handoff_submitted',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'security-review-task-1',
                stage_name: 'review',
                work_item_id: 'review-work-item-1',
              },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-04-02T11:53:49Z'),
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
              current_stage: 'implement',
              active_stages: ['implement', 'review'],
              playbook_id: 'playbook-1',
              playbook_name: 'Bug Fix',
              playbook_outcome: 'Ship tested code',
              workspace_repository_url: null,
              workspace_settings: null,
              workflow_git_branch: null,
              workflow_parameters: null,
              playbook_definition: {
                stages: [
                  { name: 'reproduce' },
                  { name: 'implement' },
                  { name: 'review' },
                ],
              },
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-review-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-review-1',
              request_id: 'req-review-1',
              reason: 'task.handoff_submitted',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'security-review-task-1',
                stage_name: 'review',
                work_item_id: 'review-work-item-1',
              },
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-review-1',
              queued_at: new Date('2026-04-02T11:53:49Z'),
              started_at: new Date('2026-04-02T11:54:21Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          const inserted = readInsertedActivationTask(params);
          expect(params?.[2]).toBe('review-work-item-1');
          expect(params?.[6]).toBe('review');
          expect(inserted.input).toEqual(
            expect.objectContaining({
              current_stage: 'review',
              active_stages: ['implement', 'review'],
              events: [
                expect.objectContaining({
                  type: 'task.handoff_submitted',
                  stage_name: 'review',
                  work_item_id: 'review-work-item-1',
                }),
              ],
            }),
          );
          return { rowCount: 1, rows: [{ id: 'task-review-1' }] };
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
    expectWorkflowStageProjection({
      currentStage: 'implement',
      activeStages: ['implement', 'review'],
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-review-1');

    expect(taskId).toBe('task-review-1');
  });
});
