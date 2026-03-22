import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';
import { ValidationError } from '../../src/errors/domain-errors.js';
import {
  normalizeOrchestratorChildWorkflowLinkage,
  orchestratorControlRoutes,
} from '../../src/api/routes/orchestrator-control.routes.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
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

describe('normalizeOrchestratorChildWorkflowLinkage', () => {
  it('backfills normalized parent-child metadata on both workflows without duplicating child ids', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ metadata: { child_workflow_ids: ['wf-child-1'] } }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ metadata: { existing: true } }],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    await normalizeOrchestratorChildWorkflowLinkage(
      pool as never,
      'tenant-1',
      {
        parentWorkflowId: 'wf-parent',
        parentOrchestratorTaskId: 'task-orch-1',
        parentOrchestratorActivationId: 'activation-1',
        parentWorkItemId: 'wi-1',
        parentStageName: 'implementation',
        parentContext: 'Use the shared repo state.',
      },
      'wf-child-1',
    );

    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE workflows'),
      [
        'tenant-1',
        'wf-parent',
        {
          child_workflow_ids: ['wf-child-1'],
          latest_child_workflow_id: 'wf-child-1',
          latest_child_workflow_created_by_orchestrator_task_id: 'task-orch-1',
        },
      ],
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('UPDATE workflows'),
      [
        'tenant-1',
        'wf-child-1',
        {
          existing: true,
          parent_workflow_id: 'wf-parent',
          parent_orchestrator_task_id: 'task-orch-1',
          parent_orchestrator_activation_id: 'activation-1',
          parent_work_item_id: 'wi-1',
          parent_stage_name: 'implementation',
          parent_context: 'Use the shared repo state.',
          parent_link_kind: 'orchestrator_child',
        },
      ],
    );
  });
});

describe('orchestratorControlRoutes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('replays stored create_work_item results after recovery without rerunning the mutation', async () => {
    const workflowService = {
      createWorkflowWorkItem: vi.fn(),
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
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'create_work_item',
            'smk120-item-1',
          ]);
          return {
            rowCount: 1,
            rows: [{
              response: {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'triage',
                title: 'Recovered work item',
                goal: 'Original replay-safe goal',
                acceptance_criteria: null,
                column_id: 'backlog',
                owner_role: null,
                priority: 'normal',
                notes: null,
                metadata: {},
                completed_at: null,
                updated_at: '2026-03-12T00:00:00.000Z',
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-replay']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-replay',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'triage',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: null,
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
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'smk120-item-1',
        title: 'Recovered work item',
        goal: 'Changed replay text after recovery',
        acceptance_criteria: 'Recovered acceptance criteria',
        stage_name: 'triage',
        column_id: 'backlog',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        goal: 'Original replay-safe goal',
      }),
    );
    expect(workflowService.createWorkflowWorkItem).not.toHaveBeenCalled();
  });

  it('rejects create_work_item without request_id', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { query: vi.fn(), connect: vi.fn() });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        title: 'Recovered work item',
        goal: 'Changed replay text after recovery',
        acceptance_criteria: 'Recovered acceptance criteria',
        stage_name: 'triage',
        column_id: 'backlog',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('returns a structured no-op when successor work is not ready yet', async () => {
    const workflowService = {
      createWorkflowWorkItem: vi.fn(async () => {
        throw new ValidationError(
          "Cannot create successor work item in stage 'technical-review' while predecessor 'Draft PRD for workflow budget alerts' (requirements) still has non-terminal tasks. Wait for the current checkpoint task to finish before routing to the next stage.",
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
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'create_work_item',
            'create-wi-not-ready',
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                noop: true,
                ready: false,
                reason_code: 'predecessor_not_ready',
                stage_name: 'technical-review',
                work_item_id: null,
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-not-ready']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-not-ready',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
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
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-not-ready/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-wi-not-ready',
        parent_work_item_id: '11111111-1111-4111-8111-111111111111',
        title: 'Technical review for workflow budget alerts PRD',
        goal: 'Produce a technical review artifact for the PRD',
        acceptance_criteria: 'Review artifact exists',
        stage_name: 'technical-review',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        noop: true,
        ready: false,
        reason_code: 'predecessor_not_ready',
        stage_name: 'technical-review',
        work_item_id: null,
      }),
    );
  });

  it('rejects orchestrator continuity writes with non-allowlisted fields', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-replay']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-replay',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'release',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/continuity',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'cont-1',
        status_summary: 'waiting',
        unexpected_field: 'reject me',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('accepts orchestrator continuity writes with long next_expected_action text', async () => {
    const longAction =
      'Draft the PRD, upload it as requirements/prd.md, write workspace memory key prd_summary, and leave the required handoff to the architect.';
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'continuity_write', 'cont-long-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-replay']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-replay',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('SELECT next_expected_actor') && sql.includes('FROM workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rowCount: 1,
            rows: [{
              next_expected_actor: null,
              next_expected_action: null,
              parent_work_item_id: null,
              metadata: {},
            }],
          };
        }
        if (sql.includes('SELECT queued_at') && sql.includes('FROM workflow_activations')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return {
            rowCount: 1,
            rows: [{ queued_at: new Date('2026-03-21T17:00:00.000Z') }],
          };
        }
        if (sql.includes('SELECT EXISTS (') && sql.includes('has_newer_specialist_handoff')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            expect.any(Date),
            ['work-item-1'],
          ]);
          return {
            rowCount: 1,
            rows: [{ has_newer_specialist_handoff: false }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'work-item-1',
            'live-test-product-manager',
            longAction,
            {
              orchestrator_finish_state: {
                status_summary: 'Waiting on PRD drafting.',
                next_expected_event: 'task.handoff_submitted',
                active_subordinate_tasks: ['task-specialist-1'],
              },
            },
          ]);
          return {
            rowCount: 1,
            rows: [{
              next_expected_actor: 'live-test-product-manager',
              next_expected_action: longAction,
              metadata: {
                orchestrator_finish_state: {
                  status_summary: 'Waiting on PRD drafting.',
                  next_expected_event: 'task.handoff_submitted',
                  blocked_on: [],
                  active_subordinate_tasks: ['task-specialist-1'],
                },
              },
            }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                nextExpectedActor: 'live-test-product-manager',
                nextExpectedAction: longAction,
                continuity: {
                  status_summary: 'Waiting on PRD drafting.',
                  next_expected_event: 'task.handoff_submitted',
                  active_subordinate_tasks: ['task-specialist-1'],
                },
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => ({
        query: pool.query,
        release: vi.fn(),
      })),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/continuity',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'cont-long-1',
        next_expected_actor: 'live-test-product-manager',
        next_expected_action: longAction,
        status_summary: 'Waiting on PRD drafting.',
        next_expected_event: 'task.handoff_submitted',
        active_subordinate_tasks: ['task-specialist-1'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.nextExpectedAction).toBe(longAction);
  });

  it('resolves continuity work item from active subordinate tasks when the orchestrator task is workflow-scoped', async () => {
    const activeTaskId = '11111111-1111-4111-8111-111111111111';
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'continuity_write', 'cont-infer-1']);
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks')
          && sql.includes('WHERE tenant_id = $1')
          && sql.includes('AND id = $2')
          && !sql.includes('ANY($3')
        ) {
          expect(params).toEqual(['tenant-1', 'task-replay']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-replay',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('ANY($3::uuid[])')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', [activeTaskId]]);
          return {
            rowCount: 1,
            rows: [{ work_item_id: 'work-item-1' }],
          };
        }
        if (sql.includes('SELECT next_expected_actor') && sql.includes('FROM workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rowCount: 1,
            rows: [{
              next_expected_actor: null,
              next_expected_action: null,
              parent_work_item_id: null,
              metadata: {},
            }],
          };
        }
        if (sql.includes('SELECT queued_at') && sql.includes('FROM workflow_activations')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return {
            rowCount: 1,
            rows: [{ queued_at: new Date('2026-03-21T17:00:00.000Z') }],
          };
        }
        if (sql.includes('SELECT EXISTS (') && sql.includes('has_newer_specialist_handoff')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            expect.any(Date),
            ['work-item-1'],
          ]);
          return {
            rowCount: 1,
            rows: [{ has_newer_specialist_handoff: false }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'work-item-1',
            'live-test-product-manager',
            'Complete the active PRD task and upload requirements/prd.md.',
            {
              orchestrator_finish_state: {
                status_summary: 'PRD drafting is already in progress.',
                next_expected_event: 'task.handoff_submitted',
                active_subordinate_tasks: [activeTaskId],
              },
            },
          ]);
          return {
            rowCount: 1,
            rows: [{
              next_expected_actor: 'live-test-product-manager',
              next_expected_action: 'Complete the active PRD task and upload requirements/prd.md.',
              metadata: {
                orchestrator_finish_state: {
                  status_summary: 'PRD drafting is already in progress.',
                  next_expected_event: 'task.handoff_submitted',
                  active_subordinate_tasks: [activeTaskId],
                },
              },
            }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                nextExpectedActor: 'live-test-product-manager',
                nextExpectedAction: 'Complete the active PRD task and upload requirements/prd.md.',
                continuity: {
                  status_summary: 'PRD drafting is already in progress.',
                  next_expected_event: 'task.handoff_submitted',
                  active_subordinate_tasks: ['task-specialist-1'],
                },
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => ({
        query: pool.query,
        release: vi.fn(),
      })),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/continuity',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'cont-infer-1',
        next_expected_actor: 'live-test-product-manager',
        next_expected_action: 'Complete the active PRD task and upload requirements/prd.md.',
        status_summary: 'PRD drafting is already in progress.',
        next_expected_event: 'task.handoff_submitted',
        active_subordinate_tasks: [activeTaskId],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.nextExpectedAction).toBe(
      'Complete the active PRD task and upload requirements/prd.md.',
    );
  });

  it('accepts create_work_item without column_id so the playbook intake lane can apply', async () => {
    const workflowService = {
      createWorkflowWorkItem: vi.fn(async () => ({
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        stage_name: 'requirements',
        column_id: 'planned',
      })),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_work_item', 'create-wi-default-column']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{ response: { id: 'work-item-1', workflow_id: 'workflow-1', stage_name: 'requirements', column_id: 'planned' } }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-create-default-column']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-create-default-column',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: null,
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
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-create-default-column/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-wi-default-column',
        title: 'Requirements',
        goal: 'Define requirements',
        acceptance_criteria: 'Requirements exist',
        stage_name: 'requirements',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        request_id: 'create-wi-default-column',
        stage_name: 'requirements',
      }),
      client,
    );
    const createWorkItemPayload = (workflowService.createWorkflowWorkItem as any).mock.calls[0]?.[2];
    expect(createWorkItemPayload).not.toHaveProperty('column_id');
  });

  it('defaults parent_work_item_id from the triggering activation for planned successor work', async () => {
    const parentWorkItemId = '11111111-1111-4111-8111-111111111111';
    const workflowService = {
      createWorkflowWorkItem: vi.fn(async () => ({
        id: 'work-item-2',
        workflow_id: 'workflow-1',
        stage_name: 'implementation',
        parent_work_item_id: parentWorkItemId,
      })),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_work_item', 'create-wi-successor']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                id: 'work-item-2',
                workflow_id: 'workflow-1',
                stage_name: 'implementation',
                parent_work_item_id: parentWorkItemId,
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-create-successor']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-create-successor',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'design',
              activation_id: 'activation-parent',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-parent']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.completed',
              payload: {
                work_item_id: parentWorkItemId,
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
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-create-successor/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-wi-successor',
        title: 'Implementation',
        goal: 'Build the feature',
        acceptance_criteria: 'Feature exists and is tested',
        stage_name: 'implementation',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        request_id: 'create-wi-successor',
        stage_name: 'implementation',
        parent_work_item_id: parentWorkItemId,
      }),
      client,
    );
  });

  it('defaults parent_work_item_id for cross-stage successor work created from a task.handoff_submitted activation', async () => {
    const parentWorkItemId = '33333333-3333-4333-8333-333333333333';
    const workflowService = {
      createWorkflowWorkItem: vi.fn(async () => ({
        id: 'work-item-review',
        workflow_id: 'workflow-1',
        stage_name: 'review',
        parent_work_item_id: parentWorkItemId,
      })),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_work_item', 'create-wi-handoff']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                id: 'work-item-review',
                workflow_id: 'workflow-1',
                stage_name: 'review',
                parent_work_item_id: parentWorkItemId,
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-create-handoff-successor']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-create-handoff-successor',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-handoff',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-handoff']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-developer',
                work_item_id: parentWorkItemId,
                stage_name: 'implementation',
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
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-create-handoff-successor/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-wi-handoff',
        title: 'Review implementation',
        goal: 'Review implementation output',
        acceptance_criteria: 'Review exists',
        stage_name: 'review',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        request_id: 'create-wi-handoff',
        stage_name: 'review',
        parent_work_item_id: parentWorkItemId,
      }),
      client,
    );
  });

  it('defaults parent_work_item_id for cross-stage successor work created from a work_item.updated recovery activation', async () => {
    const parentWorkItemId = '55555555-5555-4555-8555-555555555555';
    const workflowService = {
      createWorkflowWorkItem: vi.fn(async () => ({
        id: 'work-item-fix',
        workflow_id: 'workflow-1',
        stage_name: 'fix',
        parent_work_item_id: parentWorkItemId,
      })),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_work_item', 'create-wi-recovery']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                id: 'work-item-fix',
                workflow_id: 'workflow-1',
                stage_name: 'fix',
                parent_work_item_id: parentWorkItemId,
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-create-recovery-successor']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-create-recovery-successor',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'fix',
              activation_id: 'activation-work-item-updated',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-work-item-updated']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'work_item.updated',
              payload: {
                work_item_id: parentWorkItemId,
                previous_stage_name: 'reproduce',
                stage_name: 'reproduce',
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
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-create-recovery-successor/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-wi-recovery',
        title: 'Fix implementation',
        goal: 'Implement the approved change',
        acceptance_criteria: 'Fix exists and is verified',
        stage_name: 'fix',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        request_id: 'create-wi-recovery',
        stage_name: 'fix',
        parent_work_item_id: parentWorkItemId,
      }),
      client,
    );
  });

  it('writes orchestrator memory into an explicitly targeted work-item scope', async () => {
    const workItemId = '11111111-1111-4111-8111-111111111111';
    const workflowService = {
      getWorkflowWorkItem: vi.fn().mockResolvedValue({ id: workItemId }),
    };
    const workspaceService = {
      patchWorkspaceMemory: vi.fn().mockResolvedValue({ key: 'memory-key', work_item_id: workItemId }),
      removeWorkspaceMemory: vi.fn(),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'memory_write', 'memory-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{ response: { key: 'memory-key', work_item_id: workItemId } }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-memory']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-memory',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
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
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', workspaceService);

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-memory/memory',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'memory-1',
        key: 'memory-key',
        value: { summary: 'Scoped to the current work item' },
        work_item_id: workItemId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(workflowService.getWorkflowWorkItem).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      workItemId,
    );
    expect(workspaceService.patchWorkspaceMemory).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workspace-1',
      expect.objectContaining({
        key: 'memory-key',
        work_item_id: workItemId,
        context: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: workItemId,
          task_id: 'task-memory',
        }),
      }),
      client,
    );
  });

  it('accepts design-shaped orchestrator memory updates objects through the replay-safe bridge', async () => {
    const workspaceService = {
      patchWorkspaceMemory: vi.fn(),
      patchWorkspaceMemoryEntries: vi.fn().mockResolvedValue({
        id: 'workspace-1',
        memory: {
          summary: 'Scoped note',
          decision: { outcome: 'ship' },
        },
      }),
      removeWorkspaceMemory: vi.fn(),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'memory_write', 'memory-updates-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                id: 'workspace-1',
                memory: {
                  summary: 'Scoped note',
                  decision: { outcome: 'ship' },
                },
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-memory']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-memory',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
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
    app.decorate('workflowService', { getWorkflowWorkItem: vi.fn(), createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', workspaceService);

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-memory/memory',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'memory-updates-1',
        updates: {
          summary: 'Scoped note',
          decision: { outcome: 'ship' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(workspaceService.patchWorkspaceMemoryEntries).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workspace-1',
      [
        {
          key: 'summary',
          value: 'Scoped note',
          context: {
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-memory',
            stage_name: 'requirements',
          },
        },
        {
          key: 'decision',
          value: { outcome: 'ship' },
          context: {
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-memory',
            stage_name: 'requirements',
          },
        },
      ],
      client,
    );
    expect(response.json().data.memory).toEqual({
      summary: 'Scoped note',
      decision: { outcome: 'ship' },
    });
  });

  it('rejects orchestrator memory writes that try to persist workflow status', async () => {
    const workspaceService = {
      patchWorkspaceMemory: vi.fn(),
      patchWorkspaceMemoryEntries: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-memory']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-memory',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { getWorkflowWorkItem: vi.fn(), createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', workspaceService);

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-memory/memory',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'memory-status-1',
        updates: {
          requirements_gate_status: {
            state: 'awaiting_human_approval',
            checkpoint: 'requirements',
            work_item_id: 'work-item-1',
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(workspaceService.patchWorkspaceMemoryEntries).not.toHaveBeenCalled();
  });

  it('rejects memory_delete without request_id', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { query: vi.fn(), connect: vi.fn() });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/orchestrator/tasks/task-memory/memory/memory-key',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('updates specialist task input through the idempotent orchestrator bridge', async () => {
    const updatedTask = {
      id: 'task-specialist',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      input: { scope: 'narrowed' },
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn().mockResolvedValue(updatedTask),
      updateTaskInput: vi.fn().mockResolvedValue(updatedTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'update_task_input', 'task-input-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: updatedTask }] };
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
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
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
      method: 'PATCH',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/task-specialist/input',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'task-input-1',
        input: { scope: 'narrowed' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-specialist');
    expect(taskService.updateTaskInput).toHaveBeenCalledWith(
      'tenant-1',
      'task-specialist',
      { scope: 'narrowed' },
      client,
    );
    expect(response.json().data).toEqual(updatedTask);
  });

  it('creates a specialist task with the canonical orchestrator contract fields', async () => {
    const workItemId = '11111111-1111-4111-8111-111111111111';
    const createdTask = {
      id: 'task-specialist',
      workflow_id: 'workflow-1',
      work_item_id: workItemId,
      stage_name: 'implementation',
      role: 'developer',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-task-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
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
              work_item_id: null,
              stage_name: 'implementation',
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
              stage_name: 'implementation',
              parent_work_item_id: null,
              parent_id: null,
              parent_stage_name: null,
              workflow_lifecycle: 'planned',
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
        request_id: 'create-task-1',
        title: 'Implement auth flow',
        description: 'Implement the authentication workflow end to end.',
        work_item_id: workItemId,
        stage_name: 'implementation',
        role: 'developer',
        type: 'code',
        credentials: {
          git_token_ref: 'secret:GITHUB_PAT',
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        title: 'Implement auth flow',
        description: 'Implement the authentication workflow end to end.',
        work_item_id: workItemId,
        stage_name: 'implementation',
        role: 'developer',
        type: 'code',
        credentials: {
          git_token_ref: 'secret:GITHUB_PAT',
        },
        metadata: expect.objectContaining({
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-1',
        }),
      }),
      client,
    );
    expect(taskService.createTask.mock.calls[0]?.[1]?.capabilities_required).toBeUndefined();
    expect(response.json().data).toEqual(createdTask);
  });

  it('rejects legacy capabilities_required on specialist task creation', async () => {
    const taskService = {
      createTask: vi.fn(),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
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
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
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
        request_id: 'create-task-legacy',
        title: 'Legacy task',
        role: 'developer',
        type: 'code',
        capabilities_required: ['coding'],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  it('defaults reviewer task linkage from a task.output_pending_assessment activation', async () => {
    const reviewWorkItemId = '22222222-2222-4222-8222-222222222222';
    const createdTask = {
      id: 'task-reviewer',
      workflow_id: 'workflow-1',
      work_item_id: reviewWorkItemId,
      stage_name: 'review',
      role: 'reviewer',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-review-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            reviewWorkItemId,
            'reviewer',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-developer',
            1,
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT input') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'task-developer', 'workflow-1']);
          return {
            rowCount: 1,
            rows: [{ input: {} }],
          };
        }
        if (sql.includes('SELECT id, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{ id: 'task-developer', rework_count: 0 }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'implementation-item',
              stage_name: 'implementation',
              activation_id: 'activation-review',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND workflow_id = $2') && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              rework_count: 0,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', reviewWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: reviewWorkItemId,
              stage_name: 'review',
              parent_work_item_id: 'implementation-item',
              parent_id: 'implementation-item',
              parent_stage_name: 'implementation',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-review']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.output_pending_assessment',
              payload: {
                task_id: 'task-developer',
                work_item_id: 'implementation-item',
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
        request_id: 'create-review-1',
        title: 'Review hello world output',
        description: 'Review the developer-delivered work.',
        work_item_id: reviewWorkItemId,
        stage_name: 'review',
        role: 'reviewer',
        type: 'assessment',
        metadata: { task_kind: 'assessment' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        role: 'reviewer',
        input: expect.objectContaining({
          subject_task_id: 'task-developer',
          subject_revision: 1,
        }),
        metadata: expect.objectContaining({
          subject_linkage_source: 'activation_default',
          subject_task_id: 'task-developer',
          subject_revision: 1,
          task_kind: 'assessment',
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-review',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('returns the existing reviewer task when output_pending_assessment replays for the same reviewed task revision', async () => {
    const reviewWorkItemId = '22222222-2222-4222-8222-222222222222';
    const existingTask = {
      id: 'task-reviewer-existing',
      workflow_id: 'workflow-1',
      work_item_id: reviewWorkItemId,
      stage_name: 'review',
      role: 'reviewer',
      state: 'completed',
      metadata: {
        subject_task_id: 'task-developer',
        subject_revision: 1,
        task_kind: 'assessment',
      },
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn().mockResolvedValue(existingTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-review-duplicate']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            reviewWorkItemId,
            'reviewer',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-developer',
            1,
          ]);
          return {
            rowCount: 1,
            rows: [{ id: existingTask.id }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: existingTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT input') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'task-developer', 'workflow-1']);
          return {
            rowCount: 1,
            rows: [{ input: {} }],
          };
        }
        if (sql.includes('SELECT id, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{ id: 'task-developer', rework_count: 0 }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'implementation-item',
              stage_name: 'implementation',
              activation_id: 'activation-review',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND workflow_id = $2') && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              rework_count: 0,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', reviewWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: reviewWorkItemId,
              stage_name: 'review',
              parent_work_item_id: 'implementation-item',
              parent_id: 'implementation-item',
              parent_stage_name: 'implementation',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-review']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.output_pending_assessment',
              payload: {
                task_id: 'task-developer',
                work_item_id: 'implementation-item',
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
        request_id: 'create-review-duplicate',
        title: 'Review hello world output',
        description: 'Review the developer-delivered work.',
        work_item_id: reviewWorkItemId,
        stage_name: 'review',
        role: 'reviewer',
        type: 'assessment',
        metadata: { task_kind: 'assessment' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', existingTask.id);
    expect(response.json().data).toEqual(existingTask);
  });

  it('returns the reopened subject task when assessment_requested_changes already reactivated it', async () => {
    const implementationWorkItemId = '33333333-3333-4333-8333-333333333333';
    const verificationWorkItemId = '44444444-4444-4444-8444-444444444444';
    const existingTask = {
      id: 'task-developer',
      workflow_id: 'workflow-1',
      work_item_id: implementationWorkItemId,
      stage_name: 'implementation',
      role: 'live-test-developer',
      state: 'in_progress',
      metadata: {
        assessment_action: 'request_changes',
      },
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn().mockResolvedValue(existingTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-rework-reuse-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-rework']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.assessment_requested_changes',
              payload: {
                task_id: existingTask.id,
                task_role: 'live-test-developer',
                stage_name: 'implementation',
                work_item_id: implementationWorkItemId,
              },
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND workflow_id = $2') && sql.includes('AND id = $3')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            existingTask.id,
            'live-test-developer',
            ['pending', 'ready', 'claimed', 'in_progress', 'output_pending_assessment'],
          ]);
          return {
            rowCount: 1,
            rows: [{ id: existingTask.id }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: existingTask }] };
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
              work_item_id: implementationWorkItemId,
              stage_name: 'implementation',
              activation_id: 'activation-rework',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', verificationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: verificationWorkItemId,
              stage_name: 'verification',
              parent_work_item_id: 'review-item',
              parent_id: 'review-item',
              parent_stage_name: 'review',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-rework']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.assessment_requested_changes',
              payload: {
                task_id: existingTask.id,
                task_role: 'live-test-developer',
                stage_name: 'implementation',
                work_item_id: implementationWorkItemId,
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
        request_id: 'create-rework-reuse-1',
        title: 'Add invalid-input stderr coverage and rerun greeting regression suite',
        description: 'Handle QA-requested rework.',
        work_item_id: verificationWorkItemId,
        stage_name: 'verification',
        role: 'live-test-developer',
        type: 'code',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', existingTask.id);
    expect(response.json().data).toEqual(existingTask);
  });

  it('defaults verification task reviewed linkage from reviewer activation lineage', async () => {
    const reviewWorkItemId = '22222222-2222-4222-8222-222222222222';
    const verificationWorkItemId = '33333333-3333-4333-8333-333333333333';
    const createdTask = {
      id: 'task-qa',
      workflow_id: 'workflow-1',
      work_item_id: verificationWorkItemId,
      stage_name: 'verification',
      role: 'live-test-qa',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-qa-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, state, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              state: 'completed',
              rework_count: 0,
            }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          if (params?.[1] === 'task-orchestrator') {
            expect(params).toEqual(['tenant-1', 'task-orchestrator']);
            return {
              rowCount: 1,
              rows: [{
                id: 'task-orchestrator',
                workflow_id: 'workflow-1',
                workspace_id: 'workspace-1',
                work_item_id: reviewWorkItemId,
                stage_name: 'review',
                activation_id: 'activation-handoff-review',
                assigned_agent_id: 'agent-1',
                is_orchestrator_task: true,
                state: 'in_progress',
              }],
            };
          }
          if (params?.[1] === 'task-reviewer') {
            expect(params).toEqual(['tenant-1', 'task-reviewer', 'workflow-1']);
            return {
              rowCount: 1,
              rows: [{
                id: 'task-reviewer',
                workflow_id: 'workflow-1',
                role: 'live-test-reviewer',
                input: {
                  subject_task_id: 'task-developer',
                  subject_revision: 1,
                },
              }],
            };
          }
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', reviewWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: reviewWorkItemId,
              stage_name: 'review',
              parent_work_item_id: 'implementation-item',
              parent_id: 'implementation-item',
              parent_stage_name: 'implementation',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id = $3') && sql.includes('stage_name = $4')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', reviewWorkItemId, 'verification']);
          return {
            rowCount: 1,
            rows: [{ id: verificationWorkItemId }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-handoff-review']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-reviewer',
                work_item_id: reviewWorkItemId,
                stage_name: 'review',
              },
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND workflow_id = $2') && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              rework_count: 0,
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
        request_id: 'create-qa-1',
        title: 'Validate hello world output',
        description: 'Validate the reviewer-approved work.',
        work_item_id: reviewWorkItemId,
        stage_name: 'verification',
        role: 'live-test-qa',
        type: 'test',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        work_item_id: verificationWorkItemId,
        role: 'live-test-qa',
        type: 'test',
        input: expect.objectContaining({
          subject_task_id: 'task-developer',
          subject_revision: 1,
        }),
        metadata: expect.objectContaining({
          subject_task_id: 'task-developer',
          subject_revision: 1,
          subject_linkage_source: 'activation_lineage_default',
          stage_aligned_work_item_id_source: 'child_stage_match',
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-handoff-review',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('returns a structured no-op when verification is requested before the subject task is ready', async () => {
    const verificationWorkItemId = '55555555-5555-4555-8555-555555555555';
    const taskService = {
      createTask: vi.fn(),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-qa-not-ready']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, state, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              state: 'output_pending_assessment',
              rework_count: 1,
            }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                noop: true,
                ready: false,
                reason_code: 'subject_task_not_ready',
                work_item_id: verificationWorkItemId,
                stage_name: 'verification',
                subject_task_id: 'task-developer',
                subject_task_revision: 1,
                subject_task_state: 'output_pending_assessment',
              },
            }],
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
              work_item_id: verificationWorkItemId,
              stage_name: 'verification',
              activation_id: 'activation-qa-stale',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', verificationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: verificationWorkItemId,
              stage_name: 'verification',
              parent_work_item_id: 'review-item',
              parent_id: 'review-item',
              parent_stage_name: 'review',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-qa-stale']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-reviewer',
                work_item_id: 'review-item',
                stage_name: 'review',
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
        request_id: 'create-qa-not-ready',
        title: 'Validate the reviewed implementation',
        description: 'Run QA only after the reviewed work is ready.',
        work_item_id: verificationWorkItemId,
        stage_name: 'verification',
        role: 'live-test-qa',
        type: 'test',
        input: {
          subject_task_id: 'task-developer',
          subject_revision: 1,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(response.json().data).toEqual(
      expect.objectContaining({
        noop: true,
        ready: false,
        reason_code: 'subject_task_not_ready',
        work_item_id: verificationWorkItemId,
        stage_name: 'verification',
        subject_task_id: 'task-developer',
        subject_task_revision: 1,
        subject_task_state: 'output_pending_assessment',
      }),
    );
  });

  it('returns a structured no-op when an assessment request was already applied to the triggering task', async () => {
    const implementationWorkItemId = '44444444-4444-4444-8444-444444444444';
    const verificationWorkItemId = '55555555-5555-4555-8555-555555555555';
    const taskService = {
      createTask: vi.fn(),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-qa-rework-duplicate']);
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('SELECT id, role, work_item_id, stage_name, metadata')
          && sql.includes('FROM tasks')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              role: 'live-test-developer',
              work_item_id: implementationWorkItemId,
              stage_name: 'implementation',
              metadata: {
                last_applied_assessment_request_task_id: 'task-qa',
                last_applied_assessment_request_handoff_id: 'handoff-qa-1',
              },
            }],
          };
        }
        if (
          sql.includes('SELECT id, work_item_id, stage_name')
          && sql.includes('FROM tasks')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-qa']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-qa',
              work_item_id: verificationWorkItemId,
              stage_name: 'verification',
            }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                noop: true,
                ready: false,
                reason_code: 'assessment_request_already_applied',
                work_item_id: verificationWorkItemId,
                stage_name: 'verification',
                subject_task_id: 'task-developer',
                subject_task_stage_name: 'implementation',
                assessment_request_task_id: 'task-qa',
                assessment_request_work_item_id: verificationWorkItemId,
                assessment_request_stage_name: 'verification',
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT input') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'task-developer', 'workflow-1']);
          return {
            rowCount: 1,
            rows: [{ input: {} }],
          };
        }
        if (sql.includes('SELECT id, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{ id: 'task-developer', rework_count: 0 }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: implementationWorkItemId,
              stage_name: 'implementation',
              activation_id: 'activation-dev-output',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', verificationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: verificationWorkItemId,
              stage_name: 'verification',
              parent_work_item_id: 'review-item',
              parent_id: 'review-item',
              parent_stage_name: 'review',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-dev-output']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.output_pending_assessment',
              payload: {
                task_id: 'task-developer',
                task_role: 'live-test-developer',
                work_item_id: implementationWorkItemId,
                stage_name: 'implementation',
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
        request_id: 'create-qa-rework-duplicate',
        title: 'Address QA findings for greeting CLI verification',
        description: 'Implement QA-requested rework after the developer task was already reopened.',
        work_item_id: verificationWorkItemId,
        stage_name: 'verification',
        role: 'live-test-developer',
        type: 'code',
        input: {
          qa_findings: ['Tighten invalid invocation assertions.'],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(response.json().data).toEqual(
      expect.objectContaining({
        noop: true,
        ready: false,
        reason_code: 'assessment_request_already_applied',
        work_item_id: verificationWorkItemId,
        stage_name: 'verification',
        subject_task_id: 'task-developer',
        subject_task_stage_name: 'implementation',
        assessment_request_task_id: 'task-qa',
        assessment_request_work_item_id: verificationWorkItemId,
        assessment_request_stage_name: 'verification',
      }),
    );
  });

  it('rebinds create_task to the unique child work item in the requested stage for planned workflows', async () => {
    const predecessorWorkItemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const approvalWorkItemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const createdTask = {
      id: 'task-approval-pm',
      workflow_id: 'workflow-1',
      work_item_id: approvalWorkItemId,
      stage_name: 'approval',
      role: 'product-manager',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-approval-task-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
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
              work_item_id: predecessorWorkItemId,
              stage_name: 'technical-review',
              activation_id: 'activation-approval',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', predecessorWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: predecessorWorkItemId,
              stage_name: 'technical-review',
              parent_work_item_id: null,
              parent_stage_name: null,
              parent_id: null,
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id = $3') && sql.includes('stage_name = $4')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', predecessorWorkItemId, 'approval']);
          return {
            rowCount: 1,
            rows: [{ id: approvalWorkItemId }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-approval']);
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
        request_id: 'create-approval-task-1',
        title: 'Prepare approval package',
        description: 'Revise the PRD and prepare it for approval.',
        work_item_id: predecessorWorkItemId,
        stage_name: 'approval',
        role: 'product-manager',
        type: 'docs',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        work_item_id: approvalWorkItemId,
        stage_name: 'approval',
        metadata: expect.objectContaining({
          stage_aligned_work_item_id_source: 'child_stage_match',
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-approval',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('defaults custom assessment-role linkage from a task.handoff_submitted activation when task type is assessment', async () => {
    const reviewWorkItemId = '44444444-4444-4444-8444-444444444444';
    const createdTask = {
      id: 'task-custom-reviewer',
      workflow_id: 'workflow-1',
      work_item_id: reviewWorkItemId,
      stage_name: 'review',
      role: 'live-test-reviewer',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-custom-review-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            reviewWorkItemId,
            'live-test-reviewer',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-developer',
            1,
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
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
              work_item_id: 'implementation-item',
              stage_name: 'implementation',
              activation_id: 'activation-handoff-review',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', reviewWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: reviewWorkItemId,
              stage_name: 'review',
              parent_work_item_id: 'implementation-item',
              parent_id: 'implementation-item',
              parent_stage_name: 'implementation',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-handoff-review']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-developer',
                work_item_id: 'implementation-item',
                stage_name: 'implementation',
              },
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND workflow_id = $2') && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              rework_count: 0,
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
        request_id: 'create-custom-review-1',
        title: 'Review hello world output',
        description: 'Review the developer-delivered work.',
        work_item_id: reviewWorkItemId,
        stage_name: 'review',
        role: 'live-test-reviewer',
        type: 'assessment',
        metadata: { task_kind: 'assessment' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        role: 'live-test-reviewer',
        type: 'assessment',
        input: expect.objectContaining({
          subject_task_id: 'task-developer',
          subject_revision: 1,
        }),
        metadata: expect.objectContaining({
          subject_linkage_source: 'activation_default',
          subject_task_id: 'task-developer',
          subject_revision: 1,
          task_kind: 'assessment',
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-handoff-review',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('defaults assessment linkage to the activating delivery task on task.handoff_submitted when only the public task type is set', async () => {
    const assessmentWorkItemId = '55555555-5555-4555-8555-555555555555';
    const createdTask = {
      id: 'task-acceptance-assessor',
      workflow_id: 'workflow-1',
      work_item_id: assessmentWorkItemId,
      stage_name: 'implementation',
      role: 'acceptance-gate-assessor',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-assessment-fix-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            assessmentWorkItemId,
            'acceptance-gate-assessor',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-implementer',
            1,
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT input, metadata') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'task-implementer', 'workflow-1']);
          return {
            rowCount: 1,
            rows: [{
              input: { subject_task_id: 'task-architect' },
              metadata: { task_kind: 'delivery' },
              is_orchestrator_task: false,
            }],
          };
        }
        if (sql.includes('SELECT id, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-implementer']);
          return {
            rowCount: 1,
            rows: [{ id: 'task-implementer', rework_count: 0 }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'implementation-item',
              stage_name: 'implementation',
              activation_id: 'activation-assessment',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', assessmentWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: assessmentWorkItemId,
              stage_name: 'implementation',
              parent_work_item_id: 'implementation-item',
              parent_id: 'implementation-item',
              parent_stage_name: 'implementation',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-assessment']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-implementer',
                work_item_id: 'implementation-item',
                stage_name: 'implementation',
              },
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND workflow_id = $2') && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-implementer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-implementer',
              rework_count: 0,
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
        request_id: 'create-assessment-fix-1',
        title: 'Assess implementation output',
        description: 'Assess the implementation deliverable after handoff submission.',
        work_item_id: assessmentWorkItemId,
        stage_name: 'implementation',
        role: 'acceptance-gate-assessor',
        type: 'assessment',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        role: 'acceptance-gate-assessor',
        type: 'assessment',
        input: expect.objectContaining({
          subject_task_id: 'task-implementer',
          subject_revision: 1,
        }),
        metadata: expect.objectContaining({
          subject_linkage_source: 'activation_default',
          subject_task_id: 'task-implementer',
          subject_revision: 1,
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-assessment',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('rejects create_task when canonical required fields are missing', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { query: vi.fn(), connect: vi.fn() });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
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
        request_id: 'create-task-2',
        title: 'Implement auth flow',
        work_item_id: '11111111-1111-4111-8111-111111111111',
        role: 'developer',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('approves a specialist task through the replay-safe orchestrator bridge', async () => {
    const approvedTask = {
      id: 'task-specialist',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'ready',
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn().mockResolvedValue(approvedTask),
      approveTask: vi.fn().mockResolvedValue(approvedTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'approve_task', 'approve-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: approvedTask }] };
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
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
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
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/task-specialist/approve',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'approve-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.approveTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-specialist',
      client,
    );
    expect(response.json().data).toEqual(approvedTask);
  });

  it('escalates a specialist task to human review through the replay-safe orchestrator bridge', async () => {
    const escalatedTask = {
      id: 'task-specialist',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'escalated',
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn().mockResolvedValue(escalatedTask),
      escalateTask: vi.fn().mockResolvedValue(escalatedTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'escalate_to_human', 'escalate-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: escalatedTask }] };
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
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
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
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/task-specialist/escalate-to-human',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'escalate-1',
        reason: 'Needs product approval',
        context: {
          summary: 'Plan is blocked on a pricing decision.',
          artifact_id: 'artifact-1',
        },
        recommendation: 'Approve the enterprise pricing change.',
        blocking_task_id: '11111111-1111-1111-1111-111111111111',
        urgency: 'critical',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.escalateTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-specialist',
      {
        reason: 'Needs product approval',
        context: {
          summary: 'Plan is blocked on a pricing decision.',
          artifact_id: 'artifact-1',
        },
        recommendation: 'Approve the enterprise pricing change.',
        blocking_task_id: '11111111-1111-1111-1111-111111111111',
        urgency: 'critical',
        escalation_target: 'human',
      },
      client,
    );
    expect(response.json().data).toEqual(escalatedTask);
  });

  it('reads the scoped workflow budget for an orchestrator task', async () => {
    const workflowService = {
      getWorkflowBudget: vi.fn().mockResolvedValue({
        tokens_used: 1200,
        tokens_limit: 5000,
        cost_usd: 1.5,
      }),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orch-budget']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orch-budget',
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
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orchestrator/tasks/task-orch-budget/workflow/budget',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(workflowService.getWorkflowBudget).toHaveBeenCalledWith('tenant-1', 'workflow-1');
    expect(response.json().data).toEqual(
      expect.objectContaining({ tokens_used: 1200, cost_usd: 1.5 }),
    );
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

    expect(response.statusCode).toBe(200);
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

  it('recovers a stale delivery_in_progress managed-task message on replay', async () => {
    const managedTask = {
      id: 'task-managed-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'in_progress',
      assigned_worker_id: 'worker-1',
      stage_name: 'implementation',
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
      delivery_state: 'delivery_in_progress',
      delivery_attempt_count: 1,
      last_delivery_attempt_at: new Date('2026-03-12T00:00:00.000Z'),
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
      delivery_state: 'delivery_in_progress',
    };
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-12T00:00:20.000Z').getTime());
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
            delivery_attempt_count: 2,
            last_delivery_attempt_at: new Date('2026-03-12T00:00:20.000Z'),
          };
          return { rowCount: 1, rows: [messageRow] };
        }
        if (sql.includes('UPDATE orchestrator_task_messages') && sql.includes('delivered_at = CASE WHEN $2 = \'delivered\'')) {
          messageRow = {
            ...messageRow,
            delivery_state: 'delivered',
            delivered_at: new Date('2026-03-12T00:00:21.000Z'),
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
    app.decorate('config', {
      TASK_DEFAULT_TIMEOUT_MINUTES: 30,
    });
    app.decorate('eventService', { emit });
    app.decorate('workflowService', { getWorkflowBudget: vi.fn() });
    app.decorate('workerConnectionHub', { sendToWorker });
    app.decorate('taskService', { createTask: vi.fn(), getTask: vi.fn() });
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
    expect(messageRow.delivery_attempt_count).toBe(2);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        success: true,
        delivered: true,
        message_id: 'msg-1',
        delivery_state: 'delivered',
      }),
    );
    dateNow.mockRestore();
  });

  it('retries a deferred worker_unavailable managed-task message on replay once the worker is reachable', async () => {
    const managedTask = {
      id: 'task-managed-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'in_progress',
      assigned_worker_id: 'worker-1',
      stage_name: 'implementation',
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
      delivery_state: 'worker_unavailable',
      delivery_attempt_count: 1,
      last_delivery_attempt_at: new Date('2026-03-12T00:00:00.000Z'),
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
      delivery_state: 'worker_unavailable',
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
            delivery_attempt_count: 2,
            last_delivery_attempt_at: new Date('2026-03-12T00:00:10.000Z'),
          };
          return { rowCount: 1, rows: [messageRow] };
        }
        if (sql.includes('UPDATE orchestrator_task_messages') && sql.includes('delivered_at = CASE WHEN $2 = \'delivered\'')) {
          messageRow = {
            ...messageRow,
            delivery_state: 'delivered',
            delivered_at: new Date('2026-03-12T00:00:11.000Z'),
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
    app.decorate('taskService', { createTask: vi.fn(), getTask: vi.fn() });
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
    expect(messageRow.delivery_state).toBe('delivered');
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
