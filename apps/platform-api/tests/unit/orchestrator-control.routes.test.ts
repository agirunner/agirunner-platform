import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';
import {
  normalizeOrchestratorChildWorkflowLinkage,
  orchestratorControlRoutes,
} from '../../src/api/routes/orchestrator-control.routes.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
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

describe('normalizeOrchestratorChildWorkflowLinkage', () => {
  it('backfills normalized parent-child metadata on both workflows without duplicating child ids', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ metadata: { child_workflow_ids: ['wf-child-1'] } }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ metadata: { existing: true } }],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    await normalizeOrchestratorChildWorkflowLinkage(
      pool as never,
      'tenant-1',
      {
        parentWorkflowId: 'wf-parent',
        parentOrchestratorTaskId: 'task-orch-1',
        parentOrchestratorActivationId: 'activation-1',
        parentWorkItemId: 'wi-1',
        parentStageName: 'implementation',
        parentContext: 'Use the shared repo state.',
      },
      'wf-child-1',
    );

    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE workflows'),
      [
        'tenant-1',
        'wf-parent',
        {
          child_workflow_ids: ['wf-child-1'],
          latest_child_workflow_id: 'wf-child-1',
          latest_child_workflow_created_by_orchestrator_task_id: 'task-orch-1',
        },
      ],
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('UPDATE workflows'),
      [
        'tenant-1',
        'wf-child-1',
        {
          existing: true,
          parent_workflow_id: 'wf-parent',
          parent_orchestrator_task_id: 'task-orch-1',
          parent_orchestrator_activation_id: 'activation-1',
          parent_work_item_id: 'wi-1',
          parent_stage_name: 'implementation',
          parent_context: 'Use the shared repo state.',
          parent_link_kind: 'orchestrator_child',
        },
      ],
    );
  });
});

describe('orchestratorControlRoutes', () => {
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

  it('replays stored create_work_item results after recovery without rerunning the mutation', async () => {
    const workflowService = {
      createWorkflowWorkItem: vi.fn(),
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
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'create_work_item',
            'smk120-item-1',
          ]);
          return {
            rowCount: 1,
            rows: [{
              response: {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'triage',
                title: 'Recovered work item',
                goal: 'Original replay-safe goal',
                acceptance_criteria: null,
                column_id: 'backlog',
                owner_role: null,
                priority: 'normal',
                notes: null,
                metadata: {},
                completed_at: null,
                updated_at: '2026-03-12T00:00:00.000Z',
              },
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
          expect(params).toEqual(['tenant-1', 'task-replay']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-replay',
              workflow_id: 'workflow-1',
              project_id: 'project-1',
              work_item_id: null,
              stage_name: 'triage',
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
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('projectService', {
      patchProjectMemory: vi.fn(),
      removeProjectMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'smk120-item-1',
        title: 'Recovered work item',
        goal: 'Changed replay text after recovery',
        stage_name: 'triage',
        column_id: 'backlog',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        goal: 'Original replay-safe goal',
      }),
    );
    expect(workflowService.createWorkflowWorkItem).not.toHaveBeenCalled();
  });

  it('writes orchestrator memory into an explicitly targeted work-item scope', async () => {
    const workItemId = '11111111-1111-4111-8111-111111111111';
    const workflowService = {
      getWorkflowWorkItem: vi.fn().mockResolvedValue({ id: workItemId }),
    };
    const projectService = {
      patchProjectMemory: vi.fn().mockResolvedValue({ key: 'memory-key', work_item_id: workItemId }),
      removeProjectMemory: vi.fn(),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'memory_write', 'memory-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{ response: { key: 'memory-key', work_item_id: workItemId } }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-memory']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-memory',
              workflow_id: 'workflow-1',
              project_id: 'project-1',
              work_item_id: null,
              stage_name: 'requirements',
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
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('projectService', projectService);

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-memory/memory',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'memory-1',
        key: 'memory-key',
        value: { summary: 'Scoped to the current work item' },
        work_item_id: workItemId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(workflowService.getWorkflowWorkItem).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      workItemId,
    );
    expect(projectService.patchProjectMemory).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'project-1',
      expect.objectContaining({
        key: 'memory-key',
        work_item_id: workItemId,
        context: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: workItemId,
          task_id: 'task-memory',
        }),
      }),
      client,
    );
  });
});
