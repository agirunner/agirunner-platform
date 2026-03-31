import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
  withAllowedScopes: () => async () => {},
}));

describe('workflow task routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  function createWorkflowReplayPool(workflowId: string, toolName: string) {
    let storedResponse: Record<string, unknown> | null = null;
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', workflowId, toolName, 'request-1']);
          return storedResponse
            ? { rowCount: 1, rows: [{ response: storedResponse }] }
            : { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          storedResponse = params?.[4] as Record<string, unknown>;
          return { rowCount: 1, rows: [{ response: storedResponse }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };

    return {
      pool: {
        connect: vi.fn(async () => client),
        query: vi.fn(async () => {
          throw new Error('unexpected pool query');
        }),
      },
      client,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('deduplicates workflow task agent-escalate requests for workflow-linked tasks without work items', async () => {
    const { workflowRoutes } = await import('../../../../../src/api/routes/workflows/routes.js');
    const { pool } = createWorkflowReplayPool('workflow-1', 'public_task_agent_escalate');
    const workflowService = {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      getWorkflowBoard: vi.fn(),
      listWorkflowStages: vi.fn(),
      listWorkflowWorkItems: vi.fn(),
      createWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItem: vi.fn(),
      listWorkflowWorkItemTasks: vi.fn(),
      listWorkflowWorkItemEvents: vi.fn(),
      getWorkflowWorkItemMemory: vi.fn(),
      getWorkflowWorkItemMemoryHistory: vi.fn(),
      updateWorkflowWorkItem: vi.fn(),
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    };
    const agentEscalate = vi.fn(async () => ({
      id: 'task-1',
      workflow_id: 'workflow-1',
      state: 'escalated',
    }));
    const taskService = {
      getTask: vi.fn(async () => ({
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: null,
      })),
      agentEscalate,
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', workflowService as never);
    app.decorate('taskService', taskService as never);
    app.decorate('pgPool', pool as never);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('workspaceService', { getWorkspace: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      reason: 'Need operator guidance before proceeding.',
      context_summary: 'The workflow-level task is blocked on a product decision.',
      work_so_far: 'Collected the current workflow state and repository evidence.',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/tasks/task-1/agent-escalate',
      headers: { authorization: 'Bearer test' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/tasks/task-1/agent-escalate',
      headers: { authorization: 'Bearer test' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-1');
    expect(agentEscalate).toHaveBeenCalledTimes(1);
    expect(agentEscalate).toHaveBeenCalledWith(
      {
        id: 'key-1',
        keyPrefix: 'prefix',
        ownerId: 'user-1',
        ownerType: 'user',
        scope: 'admin',
        tenantId: 'tenant-1',
      },
      'task-1',
      {
        reason: 'Need operator guidance before proceeding.',
        context_summary: 'The workflow-level task is blocked on a product decision.',
        work_so_far: 'Collected the current workflow state and repository evidence.',
      },
    );
    expect(second.json()).toEqual(first.json());
  });
});
