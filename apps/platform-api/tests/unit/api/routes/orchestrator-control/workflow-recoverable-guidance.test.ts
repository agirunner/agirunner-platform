import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { orchestratorControlRoutes } from '../../../../../src/api/routes/orchestrator-control/routes.js';
import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
import { ValidationError } from '../../../../../src/errors/domain-errors.js';
import { PlaybookWorkflowControlService } from '../../../../../src/services/playbook-workflow-control/playbook-workflow-control-service.js';
import { TaskAgentScopeService } from '../../../../../src/services/task/task-agent-scope-service.js';

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

function buildTaskScope(overrides: Partial<Awaited<ReturnType<TaskAgentScopeService['loadAgentOwnedOrchestratorTask']>>> = {}) {
  return {
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
    ...overrides,
  };
}

function buildClient(expectedToolName: string, expectedRequestId: string, expectedRecoveryClass: string) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', expectedToolName, expectedRequestId]);
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO workflow_tool_results')) {
        expect(params?.[5]).toBe('recoverable_not_applied');
        expect(params?.[6]).toBe(expectedRecoveryClass);
        expect(params?.[4]).toMatchObject({
          mutation_outcome: 'recoverable_not_applied',
          recovery_class: expectedRecoveryClass,
          closure_still_possible: true,
          blocking: false,
        });
        return { rowCount: 1, rows: [{ response: params?.[4] }] };
      }
      throw new Error(`unexpected client query: ${sql}`);
    }),
    release: vi.fn(),
  };
}

async function registerTestApp(client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }) {
  const app = fastify();
  registerErrorHandler(app);
  app.decorate('pgPool', { connect: vi.fn(async () => client) } as any);
  app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as any);
  app.decorate('eventService', { emit: vi.fn(async () => undefined) } as any);
  app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() } as any);
  app.decorate('taskService', {} as any);
  app.decorate('workspaceService', {
    patchWorkspaceMemory: vi.fn(),
    removeWorkspaceMemory: vi.fn(),
  } as any);
  await app.register(orchestratorControlRoutes);
  return app;
}

describe('orchestrator workflow recoverable guidance', () => {
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

  it('returns guided recovery when complete_workflow is attempted while specialist work is still active', async () => {
    vi.spyOn(PlaybookWorkflowControlService.prototype, 'completeWorkflow').mockRejectedValue(
      new ValidationError("Cannot complete workflow while task 'Code Reviewer' in stage 'review' is still in_progress."),
    );
    vi.spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask').mockResolvedValue(
      buildTaskScope(),
    );

    app = await registerTestApp(
      buildClient('complete_workflow', 'complete-workflow-active-tasks', 'workflow_tasks_not_ready'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/workflow/complete',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'complete-workflow-active-tasks',
        summary: 'Try to close while review is still running',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'workflow_tasks_not_ready',
      closure_still_possible: true,
    });
  });

  it('returns guided recovery when complete_workflow is attempted before required approval resolves', async () => {
    vi.spyOn(PlaybookWorkflowControlService.prototype, 'completeWorkflow').mockRejectedValue(
      new ValidationError("Stage 'release-approval' requires human approval before workflow completion"),
    );
    vi.spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask').mockResolvedValue(
      buildTaskScope({ stage_name: 'release-approval' }),
    );

    app = await registerTestApp(
      buildClient('complete_workflow', 'complete-workflow-gate', 'workflow_waiting_for_gate_approval'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/workflow/complete',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'complete-workflow-gate',
        summary: 'Try to close before the release approval lands',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'workflow_waiting_for_gate_approval',
      closure_still_possible: true,
    });
  });

  it('returns guided recovery when advance_stage is attempted from the final stage', async () => {
    vi.spyOn(PlaybookWorkflowControlService.prototype, 'advanceStage').mockRejectedValue(
      new ValidationError('No next stage is available; use complete_workflow for the final stage'),
    );
    vi.spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask').mockResolvedValue(
      buildTaskScope({ stage_name: 'release' }),
    );

    app = await registerTestApp(
      buildClient('advance_stage', 'advance-stage-final', 'final_stage_use_complete_workflow'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/stages/release/advance',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'advance-stage-final',
        summary: 'Move past the final stage',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'final_stage_use_complete_workflow',
      closure_still_possible: true,
    });
  });
});
