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
        if (sql.includes('SELECT wi.id, wi.stage_name, w.lifecycle AS workflow_lifecycle')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', verificationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: verificationWorkItemId,
              stage_name: 'verification',
              workflow_lifecycle: 'planned',
            }],
          };
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



});
