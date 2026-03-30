import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../src/errors/error-handler.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../src/errors/domain-errors.js';
import { ArtifactService } from '../../../src/services/artifact-service.js';
import { GuidedClosureRecoveryHelpersService } from '../../../src/services/guided-closure/recovery-helpers.js';
import { PlaybookWorkflowControlService } from '../../../src/services/playbook-workflow-control-service.js';
import { TaskAgentScopeService } from '../../../src/services/task-agent-scope-service.js';
import {
  normalizeExplicitAssessmentSubjectTaskLinkage,
  normalizeOrchestratorChildWorkflowLinkage,
  orchestratorControlRoutes,
} from '../../../src/api/routes/orchestrator-control.routes.js';

vi.mock('../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-key',
    };
  },
  withScope: () => async () => {},
}));


describe('orchestratorControlRoutes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('sends live managed-task messages through the worker connection hub', async () => {
    let committedMutation = false;
    const managedTask = {
      id: 'task-managed-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'in_progress',
      assigned_worker_id: 'worker-1',
      stage_name: 'implementation',
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn(),
    };
    const sendToWorker = vi.fn(() => {
      expect(committedMutation).toBe(true);
      return true;
    });
    const emit = vi.fn(async () => undefined);
    const messageRow = {
      id: 'message-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      task_id: 'task-managed-1',
      orchestrator_task_id: 'task-orch-message',
      activation_id: 'activation-1',
      stage_name: 'implementation',
      worker_id: 'worker-1',
      request_id: 'msg-1',
      urgency: 'important',
      message: 'Focus on the failing API regression first.',
      delivery_state: 'pending_delivery',
      delivery_attempt_count: 0,
      last_delivery_attempt_at: null,
      delivered_at: null,
      created_at: new Date('2026-03-12T00:00:00.000Z'),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN') {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'COMMIT') {
          committedMutation = true;
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'send_task_message', 'msg-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                success: true,
                delivered: false,
                task_id: 'task-managed-1',
                message_id: 'msg-1',
                urgency: 'important',
                delivery_state: 'pending_delivery',
              },
            }],
          };
        }
        if (sql.includes('SELECT id, workflow_id, is_orchestrator_task, state, assigned_worker_id, stage_name')) {
          expect(params).toEqual(['tenant-1', 'task-managed-1']);
          return {
            rowCount: 1,
            rows: [managedTask],
          };
        }
        if (sql.includes('INSERT INTO orchestrator_task_messages')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes('FROM orchestrator_task_messages') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes("SET delivery_state = 'delivery_in_progress'")) {
          return {
            rowCount: 1,
            rows: [
              {
                ...messageRow,
                delivery_state: 'delivery_in_progress',
                delivery_attempt_count: 1,
                last_delivery_attempt_at: new Date('2026-03-12T00:00:01.000Z'),
              },
            ],
          };
        }
        if (sql.includes('UPDATE orchestrator_task_messages') && sql.includes('delivered_at = CASE WHEN $2 = \'delivered\'')) {
          return {
            rowCount: 1,
            rows: [
              {
                ...messageRow,
                delivery_state: 'delivered',
                delivery_attempt_count: 1,
                last_delivery_attempt_at: new Date('2026-03-12T00:00:01.000Z'),
                delivered_at: new Date('2026-03-12T00:00:02.000Z'),
              },
            ],
          };
        }
        if (sql.includes('UPDATE workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                success: true,
                delivered: true,
                task_id: 'task-managed-1',
                message_id: 'msg-1',
                urgency: 'important',
                issued_at: '2026-03-12T00:00:00.000Z',
                delivery_state: 'delivered',
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql} ${JSON.stringify(params)}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM runtime_defaults')) {
          expect(params).toEqual(['tenant-1', 'platform.worker_dispatch_ack_timeout_ms']);
          return {
            rowCount: 1,
            rows: [{ config_value: '15000' }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orch-message']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orch-message',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                success: true,
                delivered: true,
                task_id: 'task-managed-1',
                message_id: 'msg-1',
                urgency: 'important',
                issued_at: '2026-03-12T00:00:00.000Z',
                delivery_state: 'delivered',
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit });
    app.decorate('workflowService', { getWorkflowBudget: vi.fn() });
    app.decorate('workerConnectionHub', { sendToWorker });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orch-message/tasks/task-managed-1/message',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'msg-1',
        message: 'Focus on the failing API regression first.',
        urgency: 'important',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(taskService.getTask).not.toHaveBeenCalled();
    expect(sendToWorker).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        type: 'task.message',
        task_id: 'task-managed-1',
        message_id: 'msg-1',
        urgency: 'important',
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.message_sent',
        entityId: 'task-managed-1',
      }),
      client,
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.message_delivered',
        entityId: 'task-managed-1',
      }),
      client,
    );
    expect(response.json().data).toEqual(
      expect.objectContaining({
        success: true,
        delivered: true,
        message_id: 'msg-1',
        delivery_state: 'delivered',
      }),
    );
  });

  it('returns a recoverable noop when messaging a managed task that is no longer in progress', async () => {
    const managedTask = {
      id: 'task-managed-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'completed',
      assigned_worker_id: 'worker-1',
      stage_name: 'implementation',
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn(),
    };
    const emit = vi.fn(async () => undefined);
    const messageRow = {
      id: 'message-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      task_id: 'task-managed-1',
      orchestrator_task_id: 'task-orch-message',
      activation_id: 'activation-1',
      stage_name: 'implementation',
      worker_id: 'worker-1',
      request_id: 'msg-stale-1',
      urgency: 'important',
      message: 'Resume the accepted rework path only if the task is still active.',
      delivery_state: 'task_not_in_progress',
      delivery_attempt_count: 0,
      last_delivery_attempt_at: null,
      delivered_at: null,
      created_at: new Date('2026-03-12T00:00:00.000Z'),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'send_task_message', 'msg-stale-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params?.[5]).toBeNull();
          expect(params?.[6]).toBeNull();
          expect(params?.[4]).toMatchObject({
            success: true,
            delivered: false,
            task_id: 'task-managed-1',
            message_id: 'msg-stale-1',
            urgency: 'important',
            delivery_state: 'task_not_in_progress',
          });
          return {
            rowCount: 1,
            rows: [{
              response: params?.[4],
            }],
          };
        }
        if (sql.includes('SELECT id, workflow_id, is_orchestrator_task, state, assigned_worker_id, stage_name')) {
          expect(params).toEqual(['tenant-1', 'task-managed-1']);
          return {
            rowCount: 1,
            rows: [managedTask],
          };
        }
        if (sql.includes('INSERT INTO orchestrator_task_messages')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes('FROM orchestrator_task_messages') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes('UPDATE orchestrator_task_messages') && sql.includes('SET delivery_state = $2')) {
          expect(params).toEqual(['message-1', 'worker_unassigned']);
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        throw new Error(`unexpected client query: ${sql} ${JSON.stringify(params)}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orch-message']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orch-message',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_tool_results')) {
          expect(params?.[5]).toBe('recoverable_not_applied');
          expect(params?.[6]).toBe('managed_task_not_in_progress');
          expect(params?.[4]).toMatchObject({
            mutation_outcome: 'recoverable_not_applied',
            recovery_class: 'managed_task_not_in_progress',
            reason_code: 'managed_task_not_in_progress',
            closure_still_possible: true,
          });
          return {
            rowCount: 1,
            rows: [{
              response: params?.[4],
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql} ${JSON.stringify(params)}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit });
    app.decorate('workflowService', { getWorkflowBudget: vi.fn() });
    app.decorate('workerConnectionHub', { sendToWorker: vi.fn(() => true) });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orch-message/tasks/task-managed-1/message',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'msg-stale-1',
        message: 'Resume the accepted rework path only if the task is still active.',
        urgency: 'important',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toMatchObject({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'managed_task_not_in_progress',
      reason_code: 'managed_task_not_in_progress',
      state_snapshot: expect.objectContaining({
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: 'task-managed-1',
        current_stage: 'implementation',
      }),
      suggested_target_ids: expect.objectContaining({
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: 'task-managed-1',
      }),
      suggested_next_actions: expect.any(Array),
    });
    expect(response.json().data).not.toHaveProperty('success');
  });

  it('returns a recoverable noop when messaging an in-progress managed task that has no assigned worker', async () => {
    const managedTask = {
      id: 'task-managed-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'in_progress',
      assigned_worker_id: null,
      stage_name: 'implementation',
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn(),
    };
    const emit = vi.fn(async () => undefined);
    const messageRow = {
      id: 'message-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      task_id: 'task-managed-1',
      orchestrator_task_id: 'task-orch-message',
      activation_id: 'activation-1',
      stage_name: 'implementation',
      worker_id: null,
      request_id: 'msg-unassigned-1',
      urgency: 'critical',
      message: 'Do not wait on this task until a worker is actually attached.',
      delivery_state: 'worker_unassigned',
      delivery_attempt_count: 0,
      last_delivery_attempt_at: null,
      delivered_at: null,
      created_at: new Date('2026-03-12T00:00:00.000Z'),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'send_task_message', 'msg-unassigned-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params?.[5]).toBeNull();
          expect(params?.[6]).toBeNull();
          expect(params?.[4]).toMatchObject({
            success: true,
            delivered: false,
            task_id: 'task-managed-1',
            message_id: 'msg-unassigned-1',
            urgency: 'critical',
            delivery_state: 'worker_unassigned',
          });
          return {
            rowCount: 1,
            rows: [{
              response: params?.[4],
            }],
          };
        }
        if (sql.includes('SELECT id, workflow_id, is_orchestrator_task, state, assigned_worker_id, stage_name')) {
          expect(params).toEqual(['tenant-1', 'task-managed-1']);
          return {
            rowCount: 1,
            rows: [managedTask],
          };
        }
        if (sql.includes('INSERT INTO orchestrator_task_messages')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes('FROM orchestrator_task_messages') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes('UPDATE orchestrator_task_messages') && sql.includes('SET delivery_state = $2')) {
          expect(params).toEqual(['message-1', 'worker_unassigned']);
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        throw new Error(`unexpected client query: ${sql} ${JSON.stringify(params)}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orch-message']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orch-message',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_tool_results')) {
          expect(params?.[5]).toBe('recoverable_not_applied');
          expect(params?.[6]).toBe('managed_task_worker_unassigned');
          expect(params?.[4]).toMatchObject({
            mutation_outcome: 'recoverable_not_applied',
            recovery_class: 'managed_task_worker_unassigned',
            reason_code: 'managed_task_worker_unassigned',
            closure_still_possible: true,
          });
          return {
            rowCount: 1,
            rows: [{
              response: params?.[4],
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql} ${JSON.stringify(params)}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit });
    app.decorate('workflowService', { getWorkflowBudget: vi.fn() });
    app.decorate('workerConnectionHub', { sendToWorker: vi.fn(() => true) });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orch-message/tasks/task-managed-1/message',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'msg-unassigned-1',
        message: 'Do not wait on this task until a worker is actually attached.',
        urgency: 'critical',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toMatchObject({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'managed_task_worker_unassigned',
      reason_code: 'managed_task_worker_unassigned',
      state_snapshot: expect.objectContaining({
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: 'task-managed-1',
        current_stage: 'implementation',
      }),
      suggested_target_ids: expect.objectContaining({
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: 'task-managed-1',
      }),
      suggested_next_actions: expect.any(Array),
    });
    expect(response.json().data).not.toHaveProperty('success');
  });



});
