import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../src/errors/error-handler.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../src/errors/domain-errors.js';
import { ArtifactService } from '../../../src/services/artifact-service.js';
import { GuidedClosureRecoveryHelpersService } from '../../../src/services/guided-closure/recovery-helpers.js';
import { PlaybookWorkflowControlService } from '../../../src/services/playbook-workflow-control-service.js';
import { TaskAgentScopeService } from '../../../src/services/task-agent-scope-service.js';
import {
  normalizeExplicitAssessmentSubjectTaskLinkage,
  normalizeOrchestratorChildWorkflowLinkage,
  orchestratorControlRoutes,
} from '../../../src/api/routes/orchestrator-control.routes.js';

vi.mock('../../../src/auth/fastify-auth-hook.js', () => ({
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

  it('creates a fresh reviewer task when delivery output_revision advances past a completed prior review revision', async () => {
    const reviewWorkItemId = '23232323-2323-4232-8232-232323232323';
    const createdTask = {
      id: 'task-reviewer-revision-3',
      workflow_id: 'workflow-1',
      work_item_id: reviewWorkItemId,
      stage_name: 'review',
      role: 'reviewer',
      state: 'pending',
      metadata: {
        subject_task_id: 'task-developer',
        subject_revision: 3,
        task_kind: 'assessment',
      },
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
      getTask: vi.fn(),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-review-revision-3']);
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
            3,
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
        if (sql.includes('SELECT id, rework_count, input, metadata, is_orchestrator_task') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              rework_count: 1,
              input: {},
              metadata: {
                task_kind: 'delivery',
                output_revision: 3,
              },
              is_orchestrator_task: false,
            }],
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
              activation_id: 'activation-review-revision-3',
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-review-revision-3']);
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
        request_id: 'create-review-revision-3',
        title: 'Review revision 3 output',
        description: 'Review the third delivery revision.',
        work_item_id: reviewWorkItemId,
        stage_name: 'review',
        role: 'reviewer',
        type: 'assessment',
        metadata: { task_kind: 'assessment' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.getTask).not.toHaveBeenCalled();
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        role: 'reviewer',
        type: 'assessment',
        input: expect.objectContaining({
          subject_task_id: 'task-developer',
          subject_revision: 3,
        }),
        metadata: expect.objectContaining({
          subject_task_id: 'task-developer',
          subject_revision: 3,
          task_kind: 'assessment',
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-review-revision-3',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
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



});
