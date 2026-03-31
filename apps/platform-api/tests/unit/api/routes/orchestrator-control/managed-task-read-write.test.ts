import { resolve } from 'node:path';
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
  const artifactLocalRoot = resolve('tmp/agirunner-platform-artifacts-test');
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

  it('rejects invalid managed task ids before loading specialist task state', async () => {
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'draft-package',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });
    const getTask = vi.fn();

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { connect: vi.fn(), query: vi.fn() });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {
      getTask,
      approveTask: vi.fn(),
    });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/task_95bde3c4/approve',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'approve-1',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('managed task id must be a valid uuid');
    expect(loadTaskScopeSpy).not.toHaveBeenCalled();
    expect(getTask).not.toHaveBeenCalled();
    loadTaskScopeSpy.mockRestore();
  });


  it('returns managed specialist task details through the orchestrator-scoped read route', async () => {
    const getTask = vi.fn(async () => ({
      id: '22222222-2222-4222-8222-222222222222',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      title: 'Assess host content',
      role: 'host-acceptance-assessor',
      state: 'completed',
      stage_name: 'maintenance-window',
      output: { summary: 'Looks good.' },
      metrics: { tokens_total: 42 },
      latest_handoff: { id: 'handoff-1', summary: 'Approved.' },
      metadata: { current_subject_revision: 1 },
      rework_count: 0,
      is_orchestrator_task: false,
    }));
    const listTaskArtifactsSpy = vi
      .spyOn(ArtifactService.prototype, 'listTaskArtifacts')
      .mockResolvedValue([
        {
          id: 'artifact-1',
          task_id: '22222222-2222-4222-8222-222222222222',
          logical_path: 'artifact:wf-1/report.md',
          content_type: 'text/markdown',
          size_bytes: 42,
          created_at: '2026-03-24T18:00:00Z',
        } as never,
      ]);

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      connect: vi.fn(),
      query: vi.fn(),
    });
    app.decorate('config', {
      TASK_DEFAULT_TIMEOUT_MINUTES: 30,
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: artifactLocalRoot,
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 300,
      ARTIFACT_PREVIEW_MAX_BYTES: 1048576,
    });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { getTask });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'maintenance-window',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/22222222-2222-4222-8222-222222222222',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(getTask).toHaveBeenCalledWith('tenant-1', '22222222-2222-4222-8222-222222222222');
    expect(listTaskArtifactsSpy).toHaveBeenCalledWith('tenant-1', '22222222-2222-4222-8222-222222222222');
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: '22222222-2222-4222-8222-222222222222',
        workflow_id: 'workflow-1',
        state: 'completed',
        title: 'Assess host content',
        artifacts: [
          expect.objectContaining({
            id: 'artifact-1',
            logical_path: 'artifact:wf-1/report.md',
          }),
        ],
      }),
    );

    listTaskArtifactsSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });


  it('updates specialist task input through the idempotent orchestrator bridge', async () => {
    const updatedTask = {
      id: '22222222-2222-4222-8222-222222222222',
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
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/22222222-2222-4222-8222-222222222222/input',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'task-input-1',
        input: { scope: 'narrowed' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', '22222222-2222-4222-8222-222222222222');
    expect(taskService.updateTaskInput).toHaveBeenCalledWith(
      'tenant-1',
      '22222222-2222-4222-8222-222222222222',
      { scope: 'narrowed' },
      client,
    );
    expect(response.json().data).toEqual(updatedTask);
  });



});
