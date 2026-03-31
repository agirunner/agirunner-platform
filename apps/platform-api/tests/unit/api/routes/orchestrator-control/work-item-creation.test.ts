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
} from '../../../../../src/api/routes/orchestrator-control.routes.js';

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
        return { rowCount: 0, rows: [] };
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
        return { rowCount: 0, rows: [] };
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
          "Cannot create successor work item in stage 'technical-review' while predecessor 'Draft PRD for workflow budget alerts' (requirements) still has non-terminal tasks. Wait for the current stage work item to finish before routing to the next stage.",
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
          expect(params?.[5]).toBe('recoverable_not_applied');
          expect(params?.[6]).toBe('predecessor_not_ready');
          expect(params?.[4]).toMatchObject({
            mutation_outcome: 'recoverable_not_applied',
            recovery_class: 'predecessor_not_ready',
            closure_still_possible: true,
          });
          return {
            rowCount: 1,
            rows: [{
              response: params?.[4],
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
        mutation_outcome: 'recoverable_not_applied',
        recovery_class: 'predecessor_not_ready',
        reason_code: 'predecessor_not_ready',
        state_snapshot: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: '11111111-1111-4111-8111-111111111111',
          current_stage: 'requirements',
          task_id: 'task-not-ready',
        }),
        suggested_target_ids: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: '11111111-1111-4111-8111-111111111111',
          task_id: 'task-not-ready',
        }),
        suggested_next_actions: expect.any(Array),
      }),
    );
    expect(response.json().data).not.toHaveProperty('noop');
    expect(response.json().data).not.toHaveProperty('ready');
    expect(response.json().data).not.toHaveProperty('message');
    expect(response.json().data).not.toHaveProperty('blocked_on');
    expect(response.json().data).not.toHaveProperty('stage_name');
    expect(response.json().data).not.toHaveProperty('work_item_id');
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



});
