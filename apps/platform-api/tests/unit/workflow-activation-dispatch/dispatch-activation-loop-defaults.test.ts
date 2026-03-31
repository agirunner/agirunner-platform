import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_RUNTIME_DEFAULTS,
  expectWorkflowStageProjection,
  readInsertedActivationTask,
  readRequiredPositiveIntegerRuntimeDefaultMock,
  readWorkflowActivationTimingDefaultsMock,
  WorkflowActivationDispatchService,
} from './test-harness.js';

describe('WorkflowActivationDispatchService', () => {
  it('uses playbook orchestrator loop defaults when dispatching orchestrator work', async () => {
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
              id: 'activation-playbook-loop-defaults',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'workflow.created:workflow-1',
              reason: 'workflow.created',
              event_type: 'workflow.created',
              payload: { stage_name: 'design' },
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = false')) {
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
              current_stage: 'design',
              active_stages: ['design'],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship tested code',
              playbook_definition: {
                process_instructions: 'Design, implement, review, release.',
                roles: ['architect', 'developer', 'reviewer'],
                stages: [],
                lifecycle: 'planned',
                orchestrator: {
                  max_iterations: 120,
                  llm_max_retries: 7,
                },
              },
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-playbook-loop-defaults',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-playbook-loop-defaults',
              request_id: 'workflow.created:workflow-1',
              reason: 'workflow.created',
              event_type: 'workflow.created',
              payload: { stage_name: 'design' },
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-playbook-loop-defaults',
              queued_at: new Date('2026-03-13T12:00:00Z'),
              started_at: new Date('2026-03-13T12:00:05Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          const inserted = readInsertedActivationTask(params);
          expect(inserted.timeoutMinutes).toBe(30);
          expect(inserted.maxIterations).toBe(120);
          expect(inserted.llmMaxRetries).toBe(7);
          return { rowCount: 1, rows: [{ id: 'task-playbook-loop-defaults' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      config: {
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      } as never,
    });

    expectWorkflowStageProjection({ currentStage: 'design', activeStages: ['design'] });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-playbook-loop-defaults');

    expect(taskId).toBe('task-playbook-loop-defaults');
  });

  it('keeps timing and runtime-default reads on the existing transaction client', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-existing-client',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-existing-client',
              reason: 'workflow.created',
              event_type: 'workflow.created',
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
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-existing-client',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-existing-client',
              request_id: 'req-existing-client',
              reason: 'workflow.created',
              event_type: 'workflow.created',
              payload: {},
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-existing-client',
              queued_at: new Date('2026-03-13T12:00:00Z'),
              started_at: new Date('2026-03-13T12:00:01Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('FROM workflows w')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow 1',
              workspace_id: 'workspace-1',
              current_stage: 'triage',
              playbook_id: 'playbook-1',
              playbook_name: 'Playbook 1',
              playbook_outcome: null,
              playbook_definition: { stages: [{ name: 'triage' }] },
              workspace_repository_url: null,
              workspace_settings: null,
              workflow_git_branch: null,
              workflow_parameters: null,
            }],
          };
        }
        if (sql.includes('SELECT id, request_id, reason, event_type, payload')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-existing-client',
              request_id: 'req-existing-client',
              reason: 'workflow.created',
              event_type: 'workflow.created',
              payload: {},
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-existing-client',
              queued_at: new Date('2026-03-13T12:00:00Z'),
              started_at: new Date('2026-03-13T12:00:01Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          const inserted = readInsertedActivationTask(params);
          expect(inserted.timeoutMinutes).toBe(45);
          expect(inserted.maxIterations).toBe(500);
          expect(inserted.llmMaxRetries).toBe(5);
          return { rowCount: 1, rows: [{ id: 'task-existing-client' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async () => {
        throw new Error('dispatchActivation should not read defaults through the pool when an existing client is supplied');
      }),
    };
    const service = new WorkflowActivationDispatchService({
      pool: pool as never,
      eventService: eventService as never,
      config: {
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      } as never,
    });

    expectWorkflowStageProjection({ currentStage: 'triage', activeStages: ['triage'] });
    readRequiredPositiveIntegerRuntimeDefaultMock.mockImplementation(async (db, _tenantId, key: string) => {
      expect(db).toBe(client);
      if (key === 'tasks.default_timeout_minutes') {
        return 45;
      }
      const value = DEFAULT_RUNTIME_DEFAULTS[key];
      if (value == null) {
        throw new Error(`unexpected runtime default lookup: ${key}`);
      }
      return value;
    });

    await expect(
      service.dispatchActivation('tenant-1', 'activation-existing-client', client as never),
    ).resolves.toBe('task-existing-client');
    expect(readWorkflowActivationTimingDefaultsMock).toHaveBeenCalledTimes(1);
    expect(readWorkflowActivationTimingDefaultsMock.mock.calls[0]?.[0]).toBe(client);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('fails fast when the runtime default task timeout is missing during activation dispatch', async () => {
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
              id: 'activation-missing-default',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-missing-default',
              reason: 'task.approved',
              event_type: 'task.approved',
              payload: { task_id: 'task-9', work_item_id: 'work-item-9' },
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = false')) {
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
              id: 'activation-missing-default',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-missing-default',
              request_id: 'req-missing-default',
              reason: 'task.approved',
              event_type: 'task.approved',
              payload: { task_id: 'task-9', work_item_id: 'work-item-9' },
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-missing-default',
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
          throw new Error('activation task insert should not run without a default timeout');
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      config: {
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      } as never,
    });

    expectWorkflowStageProjection({ activeStages: ['triage'] });
    readRequiredPositiveIntegerRuntimeDefaultMock.mockImplementation(async (_db, _tenantId, key: string) => {
      if (key === 'tasks.default_timeout_minutes') {
        throw new Error('Missing runtime default "tasks.default_timeout_minutes"');
      }
      const value = DEFAULT_RUNTIME_DEFAULTS[key];
      if (value == null) {
        throw new Error(`unexpected runtime default lookup: ${key}`);
      }
      return value;
    });

    await expect(service.dispatchActivation('tenant-1', 'activation-missing-default')).rejects.toThrow(
      'Missing runtime default "tasks.default_timeout_minutes"',
    );
  });
});
