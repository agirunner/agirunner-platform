import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createManagedTaskMessageHarness, createManagedTaskMessageRow, createManagedTask } from './support.js';

vi.mock('../../../../src/auth/fastify-auth-hook.js', () => ({
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

describe('orchestratorControlRoutes managed task message delivery', () => {
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
    const managedTask = createManagedTask();
    const messageRow = createManagedTaskMessageRow();
    const sendToWorker = vi.fn(() => {
      expect(committedMutation).toBe(true);
      return true;
    });
    const harness = await createManagedTaskMessageHarness({
      managedTask,
      messageRow,
      sendToWorker,
      clientQuery: async (sql: string, params?: unknown[]) => {
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
          return { rowCount: 1, rows: [managedTask] };
        }
        if (sql.includes('INSERT INTO orchestrator_task_messages')) {
          return { rowCount: 1, rows: [messageRow] };
        }
        if (sql.includes('FROM orchestrator_task_messages') && sql.includes('FOR UPDATE')) {
          return { rowCount: 1, rows: [messageRow] };
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
        if (sql.includes('UPDATE orchestrator_task_messages') && sql.includes("delivered_at = CASE WHEN $2 = 'delivered'")) {
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
      },
      poolQuery: async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM runtime_defaults')) {
          expect(params).toEqual(['tenant-1', 'platform.worker_dispatch_ack_timeout_ms']);
          return { rowCount: 1, rows: [{ config_value: '15000' }] };
        }
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
      },
    });

    app = harness.app;

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
    expect(harness.taskService.getTask).not.toHaveBeenCalled();
    expect(sendToWorker).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        type: 'task.message',
        task_id: 'task-managed-1',
        message_id: 'msg-1',
      }),
    );
    expect(harness.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.message_sent',
        entityId: 'task-managed-1',
      }),
      harness.client,
    );
    expect(harness.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.message_delivered',
        entityId: 'task-managed-1',
      }),
      harness.client,
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
