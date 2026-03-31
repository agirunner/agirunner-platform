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

  it('returns a structured no-op when verification is requested before the subject task is ready', async () => {
    const verificationWorkItemId = '55555555-5555-4555-8555-555555555555';
    const taskService = {
      createTask: vi.fn(),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-qa-not-ready']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, state, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              state: 'output_pending_assessment',
              rework_count: 1,
            }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params?.[5]).toBe('recoverable_not_applied');
          expect(params?.[6]).toBe('subject_task_not_ready');
          expect(params?.[4]).toMatchObject({
            mutation_outcome: 'recoverable_not_applied',
            recovery_class: 'subject_task_not_ready',
            closure_still_possible: true,
          });
          return {
            rowCount: 1,
            rows: [{
              response: params?.[4],
            }],
          };
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
              work_item_id: verificationWorkItemId,
              stage_name: 'verification',
              activation_id: 'activation-qa-stale',
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-qa-stale']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-reviewer',
                work_item_id: 'review-item',
                stage_name: 'review',
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
        request_id: 'create-qa-not-ready',
        title: 'Validate the reviewed implementation',
        description: 'Run QA only after the reviewed work is ready.',
        work_item_id: verificationWorkItemId,
        stage_name: 'verification',
        role: 'live-test-qa',
        type: 'test',
        input: {
          subject_task_id: 'task-developer',
          subject_revision: 1,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(response.json().data).toEqual(
      expect.objectContaining({
        mutation_outcome: 'recoverable_not_applied',
        recovery_class: 'subject_task_not_ready',
        reason_code: 'subject_task_not_ready',
        state_snapshot: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: verificationWorkItemId,
          current_stage: 'verification',
        }),
        suggested_target_ids: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: verificationWorkItemId,
          task_id: 'task-developer',
        }),
        suggested_next_actions: expect.any(Array),
      }),
    );
    expect(response.json().data).not.toHaveProperty('noop');
    expect(response.json().data).not.toHaveProperty('ready');
    expect(response.json().data).not.toHaveProperty('message');
    expect(response.json().data).not.toHaveProperty('blocked_on');
    expect(response.json().data).not.toHaveProperty('subject_task_id');
    expect(response.json().data).not.toHaveProperty('subject_task_revision');
    expect(response.json().data).not.toHaveProperty('subject_task_state');
  });


  it('returns a structured no-op when an assessment request was already applied to the triggering task', async () => {
    const implementationWorkItemId = '44444444-4444-4444-8444-444444444444';
    const verificationWorkItemId = '55555555-5555-4555-8555-555555555555';
    const taskService = {
      createTask: vi.fn(),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-qa-rework-duplicate']);
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('SELECT id, role, work_item_id, stage_name, metadata')
          && sql.includes('FROM tasks')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              role: 'live-test-developer',
              work_item_id: implementationWorkItemId,
              stage_name: 'implementation',
              metadata: {
                last_applied_assessment_request_task_id: 'task-qa',
                last_applied_assessment_request_handoff_id: 'handoff-qa-1',
              },
            }],
          };
        }
        if (
          sql.includes('SELECT id, work_item_id, stage_name')
          && sql.includes('FROM tasks')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-qa']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-qa',
              work_item_id: verificationWorkItemId,
              stage_name: 'verification',
            }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params?.[5]).toBe('recoverable_not_applied');
          expect(params?.[6]).toBe('assessment_request_already_applied');
          expect(params?.[4]).toMatchObject({
            mutation_outcome: 'recoverable_not_applied',
            recovery_class: 'assessment_request_already_applied',
            closure_still_possible: true,
          });
          return {
            rowCount: 1,
            rows: [{
              response: params?.[4],
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT input') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'task-developer', 'workflow-1']);
          return {
            rowCount: 1,
            rows: [{ input: {} }],
          };
        }
        if (sql.includes('SELECT id, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{ id: 'task-developer', rework_count: 0 }],
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
              work_item_id: implementationWorkItemId,
              stage_name: 'implementation',
              activation_id: 'activation-dev-output',
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-dev-output']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.output_pending_assessment',
              payload: {
                task_id: 'task-developer',
                task_role: 'live-test-developer',
                work_item_id: implementationWorkItemId,
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
        request_id: 'create-qa-rework-duplicate',
        title: 'Address QA findings for greeting CLI verification',
        description: 'Implement QA-requested rework after the developer task was already reopened.',
        work_item_id: verificationWorkItemId,
        stage_name: 'verification',
        role: 'live-test-developer',
        type: 'code',
        input: {
          qa_findings: ['Tighten invalid invocation assertions.'],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(response.json().data).toEqual(
      expect.objectContaining({
        mutation_outcome: 'recoverable_not_applied',
        recovery_class: 'assessment_request_already_applied',
        reason_code: 'assessment_request_already_applied',
        state_snapshot: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: verificationWorkItemId,
          current_stage: 'verification',
        }),
        suggested_target_ids: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: verificationWorkItemId,
          task_id: 'task-developer',
        }),
        suggested_next_actions: expect.any(Array),
      }),
    );
    expect(response.json().data).not.toHaveProperty('noop');
    expect(response.json().data).not.toHaveProperty('ready');
    expect(response.json().data).not.toHaveProperty('message');
    expect(response.json().data).not.toHaveProperty('blocked_on');
    expect(response.json().data).not.toHaveProperty('subject_task_id');
    expect(response.json().data).not.toHaveProperty('subject_task_stage_name');
    expect(response.json().data).not.toHaveProperty('assessment_request_task_id');
    expect(response.json().data).not.toHaveProperty('assessment_request_work_item_id');
    expect(response.json().data).not.toHaveProperty('assessment_request_stage_name');
  });



});
