import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
import { ConflictError, ValidationError } from '../../../../../src/errors/domain-errors.js';
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

describe('orchestratorControlRoutes create_task guided recovery', () => {
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

  it('returns structured recovery guidance when create_task uses a non-authored role name', async () => {
    const taskService = {
      createTask: vi.fn(async () => {
        throw new ValidationError(
          "Role 'software-engineer' is not defined in planned workflow playbook 'workflow-1'.",
          {
            recovery_hint: 'orchestrator_guided_recovery',
            reason_code: 'role_not_defined_in_playbook',
            workflow_id: 'workflow-1',
            work_item_id: workItemId,
            requested_role: 'software-engineer',
            linked_work_item_stage_name: 'reproduce',
            defined_roles: ['Software Developer', 'Code Reviewer'],
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-task-role-guidance']);
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
              stage_name: 'reproduce',
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
              stage_name: 'reproduce',
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
              next_expected_actor: 'Software Developer',
              next_expected_action: 'work',
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
        request_id: 'create-task-role-guidance',
        title: 'Reproduce the export timeout',
        description: 'Use the stage starter role exactly as authored.',
        work_item_id: workItemId,
        stage_name: 'reproduce',
        role: 'software-engineer',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.createTask).toHaveBeenCalledTimes(1);
    expect(response.json().data).toMatchObject({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'role_not_defined_in_playbook',
      reason_code: 'role_not_defined_in_playbook',
        state_snapshot: {
          workflow_id: 'workflow-1',
          work_item_id: workItemId,
          task_id: 'task-orchestrator',
          current_stage: 'reproduce',
      },
      suggested_next_actions: [
        expect.objectContaining({
          action_code: 'inspect_available_roles',
          target_type: 'workflow',
          target_id: 'workflow-1',
        }),
        expect.objectContaining({
          action_code: 'retry_create_task_with_authored_role',
          target_type: 'work_item',
          target_id: workItemId,
        }),
      ],
    });
  });

  it('returns structured recovery guidance when continuity expects a different actor', async () => {
    const taskService = {
      createTask: vi.fn(async () => {
        throw new ConflictError(
          "Cannot create task for role 'live-test-qa' on work item 'work-item-1' because the next expected actor is 'live-test-reviewer' for action 'assess'. Resolve the current workflow expectation before dispatching a different role.",
          {
            recovery_hint: 'orchestrator_guided_recovery',
            reason_code: 'next_expected_actor_mismatch',
            workflow_id: 'workflow-1',
            work_item_id: workItemId,
            requested_role: 'live-test-qa',
            linked_work_item_stage_name: 'review',
            next_expected_actor: 'live-test-reviewer',
            next_expected_action: 'assess',
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-task-next-actor']);
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
              next_expected_actor: 'live-test-reviewer',
              next_expected_action: 'assess',
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
        request_id: 'create-task-next-actor',
        title: 'Start QA too early',
        description: 'The reviewer still owns the next step.',
        work_item_id: workItemId,
        stage_name: 'review',
        role: 'live-test-qa',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.createTask).toHaveBeenCalledTimes(1);
    expect(response.json().data).toMatchObject({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'next_expected_actor_mismatch',
      reason_code: 'next_expected_actor_mismatch',
      suggested_next_actions: [
        expect.objectContaining({
          action_code: 'inspect_current_work_item_continuity',
          target_type: 'work_item',
          target_id: workItemId,
        }),
        expect.objectContaining({
          action_code: 'follow_expected_actor',
          target_type: 'work_item',
          target_id: workItemId,
        }),
      ],
    });
  });

  it('returns structured recovery guidance before createTask when a successor-stage task still points at the predecessor work item', async () => {
    const taskService = {
      createTask: vi.fn(),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-task-stage-mismatch']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT wi.id, wi.stage_name, w.lifecycle AS workflow_lifecycle')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', workItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: workItemId,
              stage_name: 'reproduce',
              workflow_lifecycle: 'planned',
            }],
          };
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
              stage_name: 'reproduce',
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
              stage_name: 'reproduce',
              parent_work_item_id: null,
              parent_id: null,
              parent_stage_name: null,
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id = $3') && sql.includes('stage_name = $4')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', workItemId, 'implement']);
          return {
            rowCount: 0,
            rows: [],
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
        request_id: 'create-task-stage-mismatch',
        title: 'Implement the bounded fix',
        description: 'Route the successor-stage implementation work.',
        work_item_id: workItemId,
        stage_name: 'implement',
        role: 'Software Developer',
        type: 'code',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(response.json().data).toMatchObject({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'task_stage_mismatch',
      reason_code: 'task_stage_mismatch',
      state_snapshot: {
        workflow_id: 'workflow-1',
        work_item_id: workItemId,
        task_id: 'task-orchestrator',
        current_stage: 'reproduce',
      },
      suggested_next_actions: [
        expect.objectContaining({
          action_code: 'inspect_work_item_stage',
          target_type: 'work_item',
          target_id: workItemId,
        }),
        expect.objectContaining({
          action_code: 'create_or_move_work_item_for_requested_stage',
          target_type: 'work_item',
          target_id: workItemId,
        }),
      ],
    });
  });
});
