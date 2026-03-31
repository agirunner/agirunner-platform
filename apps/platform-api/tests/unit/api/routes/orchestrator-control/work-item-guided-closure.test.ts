import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../../../src/errors/domain-errors.js';
import { ArtifactService } from '../../../../../src/services/artifacts/artifact-service.js';
import { GuidedClosureRecoveryHelpersService } from '../../../../../src/services/guided-closure/recovery-helpers.js';
import { PlaybookWorkflowControlService } from '../../../../../src/services/playbook-workflow-control/playbook-workflow-control-service.js';
import { TaskAgentScopeService } from '../../../../../src/services/task/task-agent-scope-service.js';
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


  it('reopens a work item for missing handoff recovery through the helper route', async () => {
    const reopenSpy = vi
      .spyOn(GuidedClosureRecoveryHelpersService.prototype, 'reopenWorkItemForMissingHandoff')
      .mockResolvedValue({
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        column_id: 'planned',
        completed_at: null,
      } as never);
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'review',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'reopen_work_item_for_missing_handoff', 'reopen-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: params?.[4] }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { connect: vi.fn(async () => client) });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {});
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/work-items/work-item-1/reopen-for-missing-handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'reopen-1',
        reason: 'The predecessor exited without a full handoff.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(reopenSpy).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      'work-item-1',
      { reason: 'The predecessor exited without a full handoff.' },
      expect.anything(),
    );

    reopenSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });



  it('waives a preferred step through the recovery helper route', async () => {
    const waiveSpy = vi
      .spyOn(GuidedClosureRecoveryHelpersService.prototype, 'waivePreferredStep')
      .mockResolvedValue({
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        completion_callouts: {
          waived_steps: [{ code: 'secondary_review', reason: 'Primary review was decisive.' }],
        },
      } as never);
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'review',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'waive_preferred_step', 'waive-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: params?.[4] }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { connect: vi.fn(async () => client) });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {});
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/work-items/work-item-1/waive-preferred-step',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'waive-1',
        code: 'secondary_review',
        reason: 'Primary review was decisive.',
        role: 'secondary-reviewer',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(waiveSpy).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      'work-item-1',
      {
        code: 'secondary_review',
        reason: 'Primary review was decisive.',
        role: 'secondary-reviewer',
        summary: undefined,
      },
      expect.anything(),
    );

    waiveSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });



  it('closes a work item with callouts through the helper alias route', async () => {
    const closeSpy = vi
      .spyOn(GuidedClosureRecoveryHelpersService.prototype, 'closeWorkItemWithCallouts')
      .mockResolvedValue({
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        completion_callouts: {
          completion_notes: 'Closed with advisory callouts.',
        },
      } as never);
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'review',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'close_work_item_with_callouts', 'close-helper-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: params?.[4] }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { connect: vi.fn(async () => client) });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {});
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/work-items/work-item-1/close-with-callouts',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'close-helper-1',
        completion_notes: 'Closed with advisory callouts.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(closeSpy).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      'work-item-1',
      {
        acting_task_id: 'task-orchestrator',
        request_id: 'close-helper-1',
        completion_notes: 'Closed with advisory callouts.',
      },
      expect.anything(),
    );

    closeSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });




});
