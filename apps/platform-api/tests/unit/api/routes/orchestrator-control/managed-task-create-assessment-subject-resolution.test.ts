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

  it('derives subject_revision for explicit assessment subject_task_id linkage', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id, rework_count, input, metadata, is_orchestrator_task') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-implementer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-implementer',
              rework_count: 2,
              input: { description: 'Implement revision 3 release-ready contract.' },
              metadata: { task_kind: 'delivery', description: 'Implement revision 3 release-ready contract.' },
              is_orchestrator_task: false,
            }],
          };
        }
        throw new Error(`unexpected db query: ${sql}`);
      }),
    };

    const normalized = await normalizeExplicitAssessmentSubjectTaskLinkage(
      db as never,
      'tenant-1',
      'workflow-1',
      {
        request_id: 'create-assessment-explicit-subject-1',
        title: 'Assess implementation output with explicit subject',
        description: 'Assess the explicit subject task after rework.',
        work_item_id: '5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a',
        stage_name: 'implementation',
        role: 'acceptance-gate-assessor',
        type: 'assessment',
        input: {
          subject_task_id: 'task-implementer',
        },
      },
    );

    expect(normalized.input).toMatchObject({
      subject_task_id: 'task-implementer',
      subject_revision: 3,
    });
    expect(normalized.metadata).toMatchObject({
      subject_linkage_source: 'explicit_subject_task_default',
      subject_task_id: 'task-implementer',
      subject_revision: 3,
    });
  });


  it('rebinds activation-default assessment linkage through an assessment task to its explicit subject', async () => {
    const assessmentWorkItemId = '57575757-5757-4575-8575-575757575757';
    const createdTask = {
      id: 'task-acceptance-assessor-rebound',
      workflow_id: 'workflow-1',
      work_item_id: assessmentWorkItemId,
      stage_name: 'implementation',
      role: 'acceptance-gate-assessor',
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-assessment-rebound-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            assessmentWorkItemId,
            'acceptance-gate-assessor',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-implementer',
            2,
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
        if (sql.includes('FROM task_handoffs th') && sql.includes("COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', assessmentWorkItemId]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, rework_count, input, metadata, is_orchestrator_task') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-assessor-1']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-assessor-1',
              rework_count: 0,
              input: {
                subject_task_id: 'task-implementer',
                subject_revision: 2,
              },
              metadata: {
                task_kind: 'assessment',
                subject_task_id: 'task-implementer',
                subject_revision: 2,
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
              activation_id: 'activation-assessment-rebound',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', assessmentWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: assessmentWorkItemId,
              stage_name: 'implementation',
              parent_work_item_id: 'implementation-item',
              parent_id: 'implementation-item',
              parent_stage_name: 'implementation',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-assessment-rebound']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-assessor-1',
                work_item_id: assessmentWorkItemId,
                stage_name: 'implementation',
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
        request_id: 'create-assessment-rebound-1',
        title: 'Reassess implementation output',
        description: 'Reassess the implementation deliverable after rework.',
        work_item_id: assessmentWorkItemId,
        stage_name: 'implementation',
        role: 'acceptance-gate-assessor',
        type: 'assessment',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        role: 'acceptance-gate-assessor',
        type: 'assessment',
        input: expect.objectContaining({
          subject_task_id: 'task-implementer',
          subject_revision: 2,
        }),
        metadata: expect.objectContaining({
          subject_linkage_source: 'activation_default',
          subject_task_id: 'task-implementer',
          subject_revision: 2,
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-assessment-rebound',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });


  it('rebinds assessment linkage to the target work item delivery subject on cross-stage handoff activations', async () => {
    const implementationWorkItemId = '66666666-6666-4666-8666-666666666666';
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-cross-stage-assessment-1']);
          return { rowCount: 0, rows: [] };
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
        request_id: 'create-cross-stage-assessment-1',
        title: 'Assess packaged delivery output',
        description: 'Assess the implementation deliverable after the prior stage handoff.',
        work_item_id: implementationWorkItemId,
        stage_name: 'implementation',
        role: 'delivery-quality-assessor',
        type: 'assessment',
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
