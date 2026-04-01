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

  it('accepts structured closure callouts when completing a workflow', async () => {
    const completeWorkflowSpy = vi
      .spyOn(PlaybookWorkflowControlService.prototype, 'completeWorkflow')
      .mockResolvedValue({
        workflow_id: 'workflow-1',
        state: 'completed',
        summary: 'Ship it',
        final_artifacts: ['artifacts/release-notes.md'],
        completion_callouts: {
          completion_notes: 'Shipped with one advisory escalation still open.',
          waived_steps: [{ code: 'extra_review', reason: 'Core review already covered the risk.' }],
          unresolved_advisory_items: [{ kind: 'escalation', id: 'esc-1', summary: 'Escalation was advisory.' }],
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
        stage_name: 'release',
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'complete_workflow', 'complete-workflow-1']);
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
      url: '/api/v1/orchestrator/tasks/task-orchestrator/workflow/complete',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'complete-workflow-1',
        summary: 'Ship it',
        final_artifacts: ['artifacts/release-notes.md'],
        completion_callouts: {
          residual_risks: [],
          unmet_preferred_expectations: [],
          waived_steps: [],
          unresolved_advisory_items: [],
          completion_notes: 'Workflow closed with advisory callouts.',
        },
        waived_steps: [{ code: 'extra_review', reason: 'Core review already covered the risk.' }],
        unresolved_advisory_items: [{ kind: 'escalation', id: 'esc-1', summary: 'Escalation was advisory.' }],
        completion_notes: 'Shipped with one advisory escalation still open.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(completeWorkflowSpy).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      {
        request_id: 'complete-workflow-1',
        summary: 'Ship it',
        final_artifacts: ['artifacts/release-notes.md'],
        completion_callouts: {
          residual_risks: [],
          unmet_preferred_expectations: [],
          waived_steps: [],
          unresolved_advisory_items: [],
          completion_notes: 'Workflow closed with advisory callouts.',
        },
        waived_steps: [{ code: 'extra_review', reason: 'Core review already covered the risk.' }],
        unresolved_advisory_items: [{ kind: 'escalation', id: 'esc-1', summary: 'Escalation was advisory.' }],
        completion_notes: 'Shipped with one advisory escalation still open.',
      },
      expect.anything(),
    );

    completeWorkflowSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });


  it('returns guided recovery when complete_workflow is attempted for an ongoing lifecycle workflow', async () => {
    const completeWorkflowSpy = vi
      .spyOn(PlaybookWorkflowControlService.prototype, 'completeWorkflow')
      .mockRejectedValue(new ConflictError('workflow completion blocked', {
        reason_code: 'workflow_lifecycle_not_closable',
      }));
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'drafting',
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'complete_workflow', 'complete-workflow-ongoing']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params?.[5]).toBe('recoverable_not_applied');
          expect(params?.[6]).toBe('workflow_lifecycle_not_closable');
          expect(params?.[4]).toMatchObject({
            mutation_outcome: 'recoverable_not_applied',
            recovery_class: 'workflow_lifecycle_not_closable',
            closure_still_possible: true,
            blocking: false,
          });
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
      url: '/api/v1/orchestrator/tasks/task-orchestrator/workflow/complete',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'complete-workflow-ongoing',
        summary: 'Attempt closure on an ongoing workflow',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'workflow_lifecycle_not_closable',
      closure_still_possible: true,
    });

    completeWorkflowSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });


  it('closes a workflow with callouts through the helper alias route', async () => {
    const closeSpy = vi
      .spyOn(GuidedClosureRecoveryHelpersService.prototype, 'closeWorkflowWithCallouts')
      .mockResolvedValue({
        workflow_id: 'workflow-1',
        state: 'completed',
      } as never);
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'release',
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'close_workflow_with_callouts', 'close-workflow-helper-1']);
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
      url: '/api/v1/orchestrator/tasks/task-orchestrator/workflow/close-with-callouts',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'close-workflow-helper-1',
        summary: 'Ship the release with recorded advisory callouts.',
        completion_notes: 'Closed with advisory callouts.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(closeSpy).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      {
        request_id: 'close-workflow-helper-1',
        summary: 'Ship the release with recorded advisory callouts.',
        completion_notes: 'Closed with advisory callouts.',
      },
      expect.anything(),
    );

    closeSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });



});
