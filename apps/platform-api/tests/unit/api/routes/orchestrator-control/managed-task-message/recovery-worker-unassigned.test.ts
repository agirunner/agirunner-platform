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

describe('orchestratorControlRoutes managed task message recovery', () => {
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

  it('returns a recoverable noop when messaging an in-progress managed task that has no assigned worker', async () => {
    const managedTask = createManagedTask({ assigned_worker_id: null });
    const messageRow = createManagedTaskMessageRow({
      request_id: 'msg-unassigned-1',
      message: 'Do not wait on this task until a worker is actually attached.',
      urgency: 'critical',
      worker_id: null,
      delivery_state: 'worker_unassigned',
    });

    const harness = await createManagedTaskMessageHarness({
      managedTask,
      messageRow,
      clientQuery: async (sql: string, params?: unknown[]) => {
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
          return { rowCount: 1, rows: [{ response: params?.[4] }] };
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
        if (sql.includes('UPDATE orchestrator_task_messages') && sql.includes('SET delivery_state = $2')) {
          expect(params).toEqual(['message-1', 'worker_unassigned']);
          return { rowCount: 1, rows: [messageRow] };
        }
        throw new Error(`unexpected client query: ${sql} ${JSON.stringify(params)}`);
      },
      poolQuery: async (sql: string, params?: unknown[]) => {
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
          return { rowCount: 1, rows: [{ response: params?.[4] }] };
        }
        throw new Error(`unexpected pool query: ${sql} ${JSON.stringify(params)}`);
      },
    });

    app = harness.app;

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
