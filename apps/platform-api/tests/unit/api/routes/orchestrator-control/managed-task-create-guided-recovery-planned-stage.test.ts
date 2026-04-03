import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
import { ConflictError } from '../../../../../src/errors/domain-errors.js';
import { orchestratorControlRoutes } from '../../../../../src/api/routes/orchestrator-control/routes.js';

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

describe('orchestratorControlRoutes create_task completed-stage guided recovery', () => {
  let app: ReturnType<typeof fastify> | undefined;
  const workItemId = '11111111-1111-4111-8111-111111111111';

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

  it('returns structured recovery guidance when create_task targets a completed planned stage', async () => {
    const taskService = {
      createTask: vi.fn(async () => {
        throw new ConflictError(
          "Cannot create new tasks for completed planned workflow stage 'review'",
          {
            recovery_hint: 'orchestrator_guided_recovery',
            reason_code: 'planned_stage_already_completed',
            workflow_id: 'workflow-1',
            work_item_id: workItemId,
            requested_role: 'Code Reviewer',
            linked_work_item_stage_name: 'review',
            requested_stage_name: 'review',
          },
        );
      }),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-task-completed-stage']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{ response: params?.[4] }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: workItemId,
              stage_name: 'review',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', workItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: workItemId,
              stage_name: 'review',
              parent_work_item_id: null,
              parent_id: null,
              parent_stage_name: null,
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('SELECT next_expected_actor, next_expected_action') && sql.includes('FROM workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', workItemId]);
          return {
            rowCount: 1,
            rows: [{
              next_expected_actor: 'Code Reviewer',
              next_expected_action: 'review',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: null,
              payload: {},
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
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-task-completed-stage',
        title: 'Code Review: Audit Export Hang Fix',
        description: 'Review the already-completed stage.',
        work_item_id: workItemId,
        stage_name: 'review',
        role: 'Code Reviewer',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.createTask).toHaveBeenCalledTimes(1);
    expect(response.json().data).toMatchObject({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'planned_stage_already_completed',
      reason_code: 'planned_stage_already_completed',
      state_snapshot: {
        workflow_id: 'workflow-1',
        work_item_id: workItemId,
        task_id: 'task-orchestrator',
        current_stage: 'review',
      },
      suggested_next_actions: [
        expect.objectContaining({
          action_code: 'inspect_completed_stage_state',
          target_type: 'work_item',
          target_id: workItemId,
        }),
        expect.objectContaining({
          action_code: 'route_successor_stage_or_close_current_work',
          target_type: 'work_item',
          target_id: workItemId,
        }),
      ],
    });
  });
});
