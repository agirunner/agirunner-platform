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

  it('reruns specialist work with a corrected brief through the recovery helper route', async () => {
    const rerunSpy = vi
      .spyOn(GuidedClosureRecoveryHelpersService.prototype, 'rerunTaskWithCorrectedBrief')
      .mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222', state: 'ready' } as never);
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'rerun_task_with_corrected_brief', 'rerun-1']);
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
    app.decorate('taskService', {
      getTask: vi.fn(async () => ({ id: '22222222-2222-4222-8222-222222222222', workflow_id: 'workflow-1', is_orchestrator_task: false })),
    });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/22222222-2222-4222-8222-222222222222/rerun-with-corrected-brief',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'rerun-1',
        corrected_input: { reviewer_contract: 'Use concrete findings and cite the exact artifact.' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(rerunSpy).toHaveBeenCalledWith(
      expect.anything(),
      '22222222-2222-4222-8222-222222222222',
      {
        request_id: 'rerun-1',
        corrected_input: { reviewer_contract: 'Use concrete findings and cite the exact artifact.' },
      },
      expect.anything(),
    );

    rerunSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });


  it('reattaches or replaces stale ownership through the recovery helper route', async () => {
    const reassignSpy = vi
      .spyOn(GuidedClosureRecoveryHelpersService.prototype, 'reattachOrReplaceStaleOwner')
      .mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222', state: 'ready' } as never);
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'reattach_or_replace_stale_owner', 'reassign-1']);
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
    app.decorate('taskService', {
      getTask: vi.fn(async () => ({ id: '22222222-2222-4222-8222-222222222222', workflow_id: 'workflow-1', is_orchestrator_task: false })),
    });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/22222222-2222-4222-8222-222222222222/reattach-or-replace-stale-owner',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'reassign-1',
        reason: 'The prior owner lost its lease and the task still needs progress.',
        preferred_worker_id: '00000000-0000-4000-8000-000000000001',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(reassignSpy).toHaveBeenCalledWith(
      expect.anything(),
      '22222222-2222-4222-8222-222222222222',
      {
        request_id: 'reassign-1',
        reason: 'The prior owner lost its lease and the task still needs progress.',
        preferred_worker_id: '00000000-0000-4000-8000-000000000001',
      },
      expect.anything(),
    );

    reassignSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });



});
