import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_RUNTIME_DEFAULTS,
  expectWorkflowStageProjection,
  readInsertedActivationTask,
  readRequiredPositiveIntegerRuntimeDefaultMock,
  WorkflowActivationDispatchService,
} from './test-harness.js';

describe('WorkflowActivationDispatchService', () => {
  it('dispatches a heartbeat-only activation with empty events and heartbeat telemetry', async () => {
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
        if (sql.includes('INSERT INTO tasks')) {
          const inserted = readInsertedActivationTask(params);
          expect(params?.[6]).toBe('triage');
          expect(inserted.input).toEqual(
            expect.objectContaining({
              activation_id: 'activation-heartbeat',
              activation_reason: 'heartbeat',
              activation_dispatch_attempt: 1,
              activation_dispatch_token: 'dispatch-token-heartbeat',
              active_stages: ['triage'],
              events: [],
            }),
          );
          expect(inserted.maxIterations).toBe(500);
          expect(inserted.llmMaxRetries).toBe(5);
          expect(inserted.metadata).toEqual(
            expect.objectContaining({
              activation_event_type: 'heartbeat',
              activation_reason: 'heartbeat',
              activation_event_count: 0,
            }),
          );
          return { rowCount: 1, rows: [{ id: 'task-heartbeat' }] };
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

    expect(taskId).toBe('task-heartbeat');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_started',
        data: expect.objectContaining({
          activation_id: 'activation-heartbeat',
          event_type: 'heartbeat',
          reason: 'heartbeat',
          event_count: 0,
          task_id: 'task-heartbeat',
        }),
      }),
      client,
    );
  });

  it('uses the runtime default task timeout when dispatching orchestrator work', async () => {
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
              id: 'activation-runtime-default',
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
              id: 'activation-runtime-default',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-runtime-default',
              request_id: 'heartbeat:workflow-1:5911344',
              reason: 'heartbeat',
              event_type: 'heartbeat',
              payload: {},
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-runtime-default',
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
          expect(inserted.timeoutMinutes).toBe(45);
          expect(inserted.maxIterations).toBe(500);
          expect(inserted.llmMaxRetries).toBe(5);
          return { rowCount: 1, rows: [{ id: 'task-runtime-default' }] };
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
        return 45;
      }
      const value = DEFAULT_RUNTIME_DEFAULTS[key];
      if (value == null) {
        throw new Error(`unexpected runtime default lookup: ${key}`);
      }
      return value;
    });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-runtime-default');

    expect(taskId).toBe('task-runtime-default');
  });

  it('creates orchestrator activation tasks with the runtime_only execution backend', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-runtime-backend',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-runtime-backend',
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
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-runtime-backend',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-runtime-backend',
              request_id: 'req-runtime-backend',
              reason: 'workflow.created',
              event_type: 'workflow.created',
              payload: {},
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-runtime-backend',
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
              id: 'activation-runtime-backend',
              request_id: 'req-runtime-backend',
              reason: 'workflow.created',
              event_type: 'workflow.created',
              payload: {},
              queued_at: new Date('2026-03-13T12:00:00Z'),
            }],
          };
        }
        if (sql.includes('SELECT 1') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO tasks')) {
          expect(sql).toContain('execution_backend');
          expect(sql).toContain("'runtime_only'");
          const inserted = readInsertedActivationTask(params);
          expect(inserted.input).toEqual(
            expect.objectContaining({
              activation_id: 'activation-runtime-backend',
              activation_reason: 'queued_events',
            }),
          );
          return { rowCount: 1, rows: [{ id: 'task-runtime-backend' }] };
        }
        if (sql.includes('UPDATE workflow_activations')) {
          return { rowCount: 1, rows: [] };
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

    const taskId = await service.dispatchActivation('tenant-1', 'activation-runtime-backend');

    expect(taskId).toBe('task-runtime-backend');
  });
});
