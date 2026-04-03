import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
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

describe('orchestratorControlRoutes request_rework', () => {
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

  it('returns recoverable guidance when request_rework targets a still-active specialist task', async () => {
    const managedTask = {
      id: '22222222-2222-4222-8222-222222222222',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      stage_name: 'review',
      is_orchestrator_task: false,
      state: 'in_progress',
      metadata: {
        task_kind: 'assessment',
      },
    };
    const taskService = {
      getTask: vi.fn().mockResolvedValue(managedTask),
      requestTaskChanges: vi.fn(),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'request_rework', 'request-rework-stale-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params?.[5]).toBe('recoverable_not_applied');
          expect(params?.[6]).toBe('task_not_ready_for_rework');
          expect(params?.[4]).toMatchObject({
            mutation_outcome: 'recoverable_not_applied',
            recovery_class: 'task_not_ready_for_rework',
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
              work_item_id: 'work-item-1',
              stage_name: 'review',
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
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/22222222-2222-4222-8222-222222222222/rework',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-rework-stale-1',
        feedback: 'Wait for the active review cycle to finish before rerouting.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.requestTaskChanges).not.toHaveBeenCalled();
    expect(response.json().data).toMatchObject({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'task_not_ready_for_rework',
      reason_code: 'task_not_ready_for_rework',
      state_snapshot: expect.objectContaining({
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: '22222222-2222-4222-8222-222222222222',
        current_stage: 'review',
      }),
      suggested_target_ids: expect.objectContaining({
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: '22222222-2222-4222-8222-222222222222',
      }),
      suggested_next_actions: expect.any(Array),
    });
  });
});
