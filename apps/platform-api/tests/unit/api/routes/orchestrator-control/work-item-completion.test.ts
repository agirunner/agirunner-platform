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


  it('accepts structured closure callouts when completing a work item', async () => {
    const completeWorkItemSpy = vi
      .spyOn(PlaybookWorkflowControlService.prototype, 'completeWorkItem')
      .mockResolvedValue({
        id: 'work-item-1',
        stage_name: 'review',
        column_id: 'done',
        completion_callouts: {
          completion_notes: 'Closed with one waived preferred review.',
          waived_steps: [{ code: 'secondary_review', reason: 'Primary review was decisive.' }],
          unresolved_advisory_items: [{ kind: 'approval', id: 'gate-1', summary: 'Approval stayed advisory.' }],
          residual_risks: [],
          unmet_preferred_expectations: [],
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'complete_work_item', 'complete-work-item-1']);
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
      url: '/api/v1/orchestrator/tasks/task-orchestrator/work-items/work-item-1/complete',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'complete-work-item-1',
        waived_steps: [{ code: 'secondary_review', reason: 'Primary review was decisive.' }],
        unresolved_advisory_items: [{ kind: 'approval', id: 'gate-1', summary: 'Approval stayed advisory.' }],
        completion_notes: 'Closed with one waived preferred review.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(completeWorkItemSpy).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      'work-item-1',
      {
        acting_task_id: 'task-orchestrator',
        request_id: 'complete-work-item-1',
        waived_steps: [{ code: 'secondary_review', reason: 'Primary review was decisive.' }],
        unresolved_advisory_items: [{ kind: 'approval', id: 'gate-1', summary: 'Approval stayed advisory.' }],
        completion_notes: 'Closed with one waived preferred review.',
      },
      expect.anything(),
    );

    completeWorkItemSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });



  it('returns a structured no-op when completing a work item before specialist tasks settle', async () => {
    const completeWorkItemSpy = vi
      .spyOn(PlaybookWorkflowControlService.prototype, 'completeWorkItem')
      .mockRejectedValue(
        new ValidationError(
          "Cannot complete work item 'Draft product brief' while task 'policy-reviewer' is still in_progress.",
        ),
      );
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'complete_work_item', 'complete-work-item-not-ready']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params?.[5]).toBe('recoverable_not_applied');
          expect(params?.[6]).toBe('work_item_tasks_not_ready');
          expect(params?.[4]).toMatchObject({
            mutation_outcome: 'recoverable_not_applied',
            recovery_class: 'work_item_tasks_not_ready',
            closure_still_possible: true,
          });
          return {
            rowCount: 1,
            rows: [{ response: params?.[4] }],
          };
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
      url: '/api/v1/orchestrator/tasks/task-orchestrator/work-items/work-item-1/complete',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'complete-work-item-not-ready',
        completion_notes: 'Close after accepted review.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        mutation_outcome: 'recoverable_not_applied',
        recovery_class: 'work_item_tasks_not_ready',
        reason_code: 'work_item_tasks_not_ready',
        state_snapshot: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          current_stage: 'review',
          task_id: 'task-orchestrator',
        }),
        suggested_target_ids: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-orchestrator',
        }),
        suggested_next_actions: expect.any(Array),
      }),
    );
    expect(response.json().data).not.toHaveProperty('noop');
    expect(response.json().data).not.toHaveProperty('ready');
    expect(response.json().data).not.toHaveProperty('message');
    expect(response.json().data).not.toHaveProperty('blocked_on');

    completeWorkItemSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });



});
