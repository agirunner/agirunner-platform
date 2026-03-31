import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../src/errors/error-handler.js';
import { orchestratorControlRoutes } from '../../../../src/api/routes/orchestrator-control.routes.js';

vi.mock('../../../../src/auth/fastify-auth-hook.js', () => ({
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

const scopedWorkItemId = '11111111-1111-4111-8111-111111111111';

describe('orchestrator control handoff routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('returns a compact work-item continuity packet for the orchestrator task scope', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orch-1']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orch-1',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', {
      getWorkflowWorkItem: vi.fn().mockResolvedValue({
        id: scopedWorkItemId,
        stage_name: 'implementation',
        column_id: 'review',
        owner_role: 'developer',
        next_expected_actor: 'reviewer',
        next_expected_action: 'assess',
        rework_count: 1,
        escalation_status: 'open',
        latest_handoff_completion: 'full',
        latest_handoff_resolution: 'request_changes',
        unresolved_findings: ['Investigate edge-case auth failures'],
        focus_areas: ['Auth edge cases'],
        known_risks: ['Refresh token expiry handling'],
        gate_status: 'rejected',
        gate_decision_feedback: 'Human rejected the checkpoint because the CLI entrypoint is missing.',
        gate_decided_at: '2026-03-16T16:31:49.959Z',
        completed_at: null,
      }),
    } as never);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/orchestrator/tasks/task-orch-1/work-items/${scopedWorkItemId}/continuity`,
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      id: scopedWorkItemId,
      stage_name: 'implementation',
      column_id: 'review',
      owner_role: 'developer',
      next_expected_actor: 'reviewer',
      next_expected_action: 'assess',
      rework_count: 1,
      escalation_status: 'open',
      latest_handoff_completion: 'full',
      latest_handoff_resolution: 'request_changes',
      unresolved_findings: ['Investigate edge-case auth failures'],
      focus_areas: ['Auth edge cases'],
      known_risks: ['Refresh token expiry handling'],
      gate_status: 'rejected',
      gate_decision_feedback: 'Human rejected the checkpoint because the CLI entrypoint is missing.',
      gate_decided_at: '2026-03-16T16:31:49.959Z',
      completed_at: null,
    });
    expect(response.json().data).not.toHaveProperty('current_checkpoint');
  });

  it('returns latest and full handoff chain for an orchestrator-scoped work item', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orch-1',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('ORDER BY sequence DESC')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'handoff-2',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: scopedWorkItemId,
              task_id: 'task-2',
              request_id: 'req-2',
              role: 'reviewer',
              team_name: null,
              stage_name: 'review',
              sequence: 1,
              summary: 'Reviewed and approved.',
              completion: 'full',
              changes: [],
              decisions: [],
              remaining_items: [],
              blockers: [],
              focus_areas: [],
              known_risks: [],
              successor_context: null,
              role_data: {},
              artifact_ids: [],
              created_at: new Date('2026-03-15T12:05:00Z'),
            }],
          };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('ORDER BY sequence ASC')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: 'handoff-1',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                work_item_id: scopedWorkItemId,
                task_id: 'task-1',
                request_id: 'req-1',
                role: 'developer',
                team_name: null,
                stage_name: 'implementation',
                sequence: 0,
                summary: 'Implemented auth flow.',
                completion: 'full',
                changes: [],
                decisions: [],
                remaining_items: [],
                blockers: [],
                focus_areas: ['error handling'],
                known_risks: [],
                successor_context: null,
                role_data: {},
                artifact_ids: [],
                created_at: new Date('2026-03-15T12:00:00Z'),
              },
              {
                id: 'handoff-2',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                work_item_id: scopedWorkItemId,
                task_id: 'task-2',
                request_id: 'req-2',
                role: 'reviewer',
                team_name: null,
                stage_name: 'review',
                sequence: 1,
                summary: 'Reviewed and approved.',
                completion: 'full',
                changes: [],
                decisions: [],
                remaining_items: [],
                blockers: [],
                focus_areas: [],
                known_risks: [],
                successor_context: null,
                role_data: {},
                artifact_ids: [],
                created_at: new Date('2026-03-15T12:05:00Z'),
              },
            ],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', {
      getWorkflowWorkItem: vi.fn().mockResolvedValue({ id: scopedWorkItemId }),
    } as never);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const latestResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/orchestrator/tasks/task-orch-1/work-items/${scopedWorkItemId}/handoffs/latest`,
      headers: { authorization: 'Bearer test' },
    });
    const chainResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/orchestrator/tasks/task-orch-1/work-items/${scopedWorkItemId}/handoffs`,
      headers: { authorization: 'Bearer test' },
    });

    expect(latestResponse.statusCode).toBe(200);
    expect(latestResponse.json().data).toEqual(
      expect.objectContaining({
        id: 'handoff-2',
        role: 'reviewer',
      }),
    );
    expect(chainResponse.statusCode).toBe(200);
    expect(chainResponse.json().data).toEqual([
      expect.objectContaining({ id: 'handoff-1', role: 'developer' }),
      expect.objectContaining({ id: 'handoff-2', role: 'reviewer' }),
    ]);
  });

  it('rejects invalid work item ids on continuity reads before hitting workflow services', async () => {
    const query = vi.fn(async () => ({
      rowCount: 0,
      rows: [],
    }));
    const getWorkflowWorkItem = vi.fn();

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { query } as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', {
      getWorkflowWorkItem,
    } as never);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orchestrator/tasks/task-orch-1/work-items/<placeholder>/continuity',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toEqual(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: 'work_item_id must be a valid uuid',
      }),
    );
    expect(query).not.toHaveBeenCalled();
    expect(getWorkflowWorkItem).not.toHaveBeenCalled();
  });

  it('rejects invalid work item ids on latest handoff reads before hitting workflow services', async () => {
    const query = vi.fn(async () => ({
      rowCount: 0,
      rows: [],
    }));
    const getWorkflowWorkItem = vi.fn();

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { query } as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', {
      getWorkflowWorkItem,
    } as never);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orchestrator/tasks/task-orch-1/work-items/<placeholder>/handoffs/latest',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toEqual(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: 'work_item_id must be a valid uuid',
      }),
    );
    expect(query).not.toHaveBeenCalled();
    expect(getWorkflowWorkItem).not.toHaveBeenCalled();
  });
});
