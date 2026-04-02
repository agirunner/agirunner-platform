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

  it('rebinds create_task to the unique child work item in the requested stage for planned workflows', async () => {
    const predecessorWorkItemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const approvalWorkItemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const createdTask = {
      id: 'task-approval-pm',
      workflow_id: 'workflow-1',
      work_item_id: approvalWorkItemId,
      stage_name: 'approval',
      role: 'product-manager',
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
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-approval-task-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT wi.id, wi.stage_name, w.lifecycle AS workflow_lifecycle')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', approvalWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: approvalWorkItemId,
              stage_name: 'approval',
              workflow_lifecycle: 'planned',
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
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: predecessorWorkItemId,
              stage_name: 'technical-review',
              activation_id: 'activation-approval',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', predecessorWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: predecessorWorkItemId,
              stage_name: 'technical-review',
              parent_work_item_id: null,
              parent_stage_name: null,
              parent_id: null,
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id = $3') && sql.includes('stage_name = $4')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', predecessorWorkItemId, 'approval']);
          return {
            rowCount: 1,
            rows: [{ id: approvalWorkItemId }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-approval']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
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
        request_id: 'create-approval-task-1',
        title: 'Prepare approval package',
        description: 'Revise the PRD and prepare it for approval.',
        work_item_id: predecessorWorkItemId,
        stage_name: 'approval',
        role: 'product-manager',
        type: 'docs',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        work_item_id: approvalWorkItemId,
        stage_name: 'approval',
        metadata: expect.objectContaining({
          stage_aligned_work_item_id_source: 'child_stage_match',
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-approval',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });


  it('infers assessment task type from the work-item expectation when create_task omits type', async () => {
    const implementationWorkItemId = '77777777-7777-4777-8777-777777777777';
    const createdTask = {
      id: 'task-quality-assessor',
      workflow_id: 'workflow-1',
      work_item_id: implementationWorkItemId,
      stage_name: 'implementation',
      role: 'delivery-quality-assessor',
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
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-inferred-assessment-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT wi.id, wi.stage_name, w.lifecycle AS workflow_lifecycle')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', implementationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: implementationWorkItemId,
              stage_name: 'implementation',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            implementationWorkItemId,
            'delivery-quality-assessor',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-implementer',
            1,
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
        if (sql.includes('SELECT next_expected_actor, next_expected_action')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', implementationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              next_expected_actor: 'delivery-quality-assessor',
              next_expected_action: 'assess',
            }],
          };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('role_data->>\'subject_task_id\'')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', implementationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              subject_task_id: 'task-implementer',
              subject_work_item_id: implementationWorkItemId,
              subject_revision: 1,
            }],
          };
        }
        if (sql.includes('SELECT id, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-implementer']);
          return {
            rowCount: 1,
            rows: [{ id: 'task-implementer', rework_count: 0 }],
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
              work_item_id: 'design-item',
              stage_name: 'design',
              activation_id: 'activation-design-handoff',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', implementationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: implementationWorkItemId,
              stage_name: 'implementation',
              parent_work_item_id: 'design-item',
              parent_id: 'design-item',
              parent_stage_name: 'design',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-design-handoff']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-architect',
                work_item_id: 'design-item',
                stage_name: 'design',
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
        request_id: 'create-inferred-assessment-1',
        title: 'Assess packaged delivery output',
        description: 'Assess the implementation deliverable after the prior stage handoff.',
        work_item_id: implementationWorkItemId,
        stage_name: 'implementation',
        role: 'delivery-quality-assessor',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        role: 'delivery-quality-assessor',
        type: 'assessment',
        input: expect.objectContaining({
          subject_task_id: 'task-implementer',
          subject_revision: 1,
        }),
        metadata: expect.objectContaining({
          subject_linkage_source: 'target_work_item_delivery_default',
          subject_task_id: 'task-implementer',
          subject_revision: 1,
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-design-handoff',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });



});
