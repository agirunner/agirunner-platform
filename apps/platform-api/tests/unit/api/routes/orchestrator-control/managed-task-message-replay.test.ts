import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../../../src/errors/domain-errors.js';
import { ArtifactService } from '../../../../../src/services/artifacts/artifact-service.js';
import { GuidedClosureRecoveryHelpersService } from '../../../../../src/services/guided-closure/recovery-helpers.js';
import { PlaybookWorkflowControlService } from '../../../../../src/services/playbook-workflow-control/playbook-workflow-control-service.js';
import { TaskAgentScopeService } from '../../../../../src/services/task-agent-scope-service.js';
import {
  normalizeExplicitAssessmentSubjectTaskLinkage,
  normalizeOrchestratorChildWorkflowLinkage,
  orchestratorControlRoutes,
} from '../../../../../src/api/routes/orchestrator-control/routes.js';

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
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


  it('delivers a stored pending managed-task message on replay without reinserting it', async () => {
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
    const sendToWorker = vi.fn().mockReturnValue(true);
    const emit = vi.fn(async () => undefined);
    let messageRow: {
      id: string;
      tenant_id: string;
      workflow_id: string;
      task_id: string;
      orchestrator_task_id: string;
      activation_id: string;
      stage_name: string;
      worker_id: string;
      request_id: string;
      urgency: string;
      message: string;
      delivery_state: string;
      delivery_attempt_count: number;
      last_delivery_attempt_at: Date | null;
      delivered_at: Date | null;
      created_at: Date;
    } = {
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
    let toolResult: Record<string, unknown> = {
      success: true,
      delivered: false,
      task_id: 'task-managed-1',
      message_id: 'msg-1',
      urgency: 'important',
      issued_at: '2026-03-12T00:00:00.000Z',
      delivery_state: 'pending_delivery',
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
          return { rowCount: 1, rows: [{ response: toolResult }] };
        }
        if (sql.includes('INSERT INTO orchestrator_task_messages')) {
          throw new Error('replay should not insert a second task message row');
        }
        if (sql.includes('SELECT id, workflow_id, is_orchestrator_task, state, assigned_worker_id, stage_name')) {
          expect(params).toEqual(['tenant-1', 'task-managed-1']);
          return {
            rowCount: 1,
            rows: [managedTask],
          };
        }
        if (sql.includes('FROM orchestrator_task_messages') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes("SET delivery_state = 'delivery_in_progress'")) {
          messageRow = {
            ...messageRow,
            delivery_state: 'delivery_in_progress',
            delivery_attempt_count: 1,
            last_delivery_attempt_at: new Date('2026-03-12T00:00:01.000Z'),
          };
          return { rowCount: 1, rows: [messageRow] };
        }
        if (sql.includes('UPDATE orchestrator_task_messages') && sql.includes('delivered_at = CASE WHEN $2 = \'delivered\'')) {
          messageRow = {
            ...messageRow,
            delivery_state: 'delivered',
            delivery_attempt_count: 1,
            last_delivery_attempt_at: new Date('2026-03-12T00:00:01.000Z'),
            delivered_at: new Date('2026-03-12T00:00:02.000Z'),
          };
          return { rowCount: 1, rows: [messageRow] };
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
          toolResult = params?.[4] as Record<string, unknown>;
          return { rowCount: 1, rows: [{ response: toolResult }] };
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

    expect(response.statusCode).toBe(200);
    expect(sendToWorker).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.message_sent',
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



});
