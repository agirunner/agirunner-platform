import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../../../src/errors/domain-errors.js';
import { ArtifactService } from '../../../../../src/services/artifact-service.js';
import { GuidedClosureRecoveryHelpersService } from '../../../../../src/services/guided-closure/recovery-helpers.js';
import { PlaybookWorkflowControlService } from '../../../../../src/services/playbook-workflow-control-service.js';
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
            null,
            null,
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
              next_expected_actor: null,
              next_expected_action: null,
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
                nextExpectedActor: null,
                nextExpectedAction: null,
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
    expect(response.json().data.nextExpectedAction).toBeNull();
    expect(response.json().data.continuity.status_summary).toBe('Waiting on PRD drafting.');
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
            null,
            null,
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
              next_expected_actor: null,
              next_expected_action: null,
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
                nextExpectedActor: null,
                nextExpectedAction: null,
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
    expect(response.json().data.nextExpectedAction).toBeNull();
    expect(response.json().data.continuity.status_summary).toBe(
      'PRD drafting is already in progress.',
    );
  });


  it('returns a structured recovery hint when continuity scope is ambiguous', async () => {
    const activeTaskIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2') && !sql.includes('ANY($3')) {
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
          expect(params).toEqual(['tenant-1', 'workflow-1', activeTaskIds]);
          return {
            rowCount: 2,
            rows: [{ work_item_id: 'work-item-1' }, { work_item_id: 'work-item-2' }],
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
        request_id: 'cont-ambiguous-1',
        next_expected_actor: 'live-test-product-manager',
        next_expected_action: 'Complete the active PRD task.',
        active_subordinate_tasks: activeTaskIds,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.recovery_hint).toBe('skip_optional_continuity_write');
    expect(response.json().error.details.reason_code).toBe('ambiguous_work_item_scope');
  });



});
