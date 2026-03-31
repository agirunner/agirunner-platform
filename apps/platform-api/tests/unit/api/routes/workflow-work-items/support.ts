import fastify from 'fastify';
import { expect, vi } from 'vitest';

import { workflowRoutes as workflowRoutesModule } from '../../../../../src/api/routes/workflows/routes.js';
import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';

export const handoffRouteMocks = {
  listWorkItemHandoffs: vi.fn(async () => [{ id: 'handoff-1', summary: 'ready' }]),
  getLatestWorkItemHandoff: vi.fn(async () => ({ id: 'handoff-1', summary: 'ready' })),
};

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

vi.mock('../../../../../src/services/handoff-service.js', () => ({
  HandoffService: class {
    listWorkItemHandoffs = handoffRouteMocks.listWorkItemHandoffs;
    getLatestWorkItemHandoff = handoffRouteMocks.getLatestWorkItemHandoff;
  },
}));

export function resetWorkflowWorkItemRouteMocks() {
  handoffRouteMocks.listWorkItemHandoffs.mockImplementation(async () => [
    { id: 'handoff-1', summary: 'ready' },
  ]);
  handoffRouteMocks.getLatestWorkItemHandoff.mockImplementation(async () => ({
    id: 'handoff-1',
    summary: 'ready',
  }));
}

function createDefaultPool() {
  return {
    query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
    connect: vi.fn(async () => ({
      query: vi.fn(async () => {
        throw new Error('unexpected pgPool.connect query');
      }),
      release: vi.fn(),
    })),
  };
}

export function createWorkflowReplayPool(workflowId: string, toolName: string) {
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

export const createTransactionalWorkflowReplayPool = createWorkflowReplayPool;

export function createWorkflowWorkItemRoutesApp(overrides?: {
  workflowService?: Record<string, unknown>;
  taskService?: Record<string, unknown>;
  pgPool?: Record<string, unknown>;
}) {
  const workflowService = {
    createWorkflow: vi.fn(async () => ({})),
    listWorkflows: vi.fn(async () => ({ data: [], meta: {} })),
    getWorkflow: vi.fn(async () => ({})),
    getWorkflowBoard: vi.fn(async () => ({})),
    listWorkflowStages: vi.fn(async () => []),
    listWorkflowWorkItems: vi.fn(async () => []),
    createWorkflowWorkItem: vi.fn(async () => ({})),
    getWorkflowWorkItem: vi.fn(async () => ({})),
    listWorkflowWorkItemTasks: vi.fn(async () => []),
    listWorkflowWorkItemEvents: vi.fn(async () => []),
    getWorkflowWorkItemMemory: vi.fn(async () => ({ entries: [] })),
    getWorkflowWorkItemMemoryHistory: vi.fn(async () => ({ history: [] })),
    updateWorkflowWorkItem: vi.fn(async () => ({})),
    resolveWorkflowWorkItemEscalation: vi.fn(async () => ({})),
    actOnStageGate: vi.fn(async () => ({})),
    getResolvedConfig: vi.fn(async () => ({})),
    cancelWorkflow: vi.fn(async () => ({})),
    pauseWorkflow: vi.fn(async () => ({})),
    resumeWorkflow: vi.fn(async () => ({})),
    deleteWorkflow: vi.fn(async () => ({})),
    ...(overrides?.workflowService ?? {}),
  };
  const taskService = {
    getTask: vi.fn(async () => ({})),
    approveTask: vi.fn(async () => ({})),
    approveTaskOutput: vi.fn(async () => ({})),
    rejectTask: vi.fn(async () => ({})),
    requestTaskChanges: vi.fn(async () => ({})),
    cancelTask: vi.fn(async () => ({})),
    overrideTaskOutput: vi.fn(async () => ({})),
    skipTask: vi.fn(async () => ({})),
    reassignTask: vi.fn(async () => ({})),
    resolveEscalation: vi.fn(async () => ({})),
    retryTask: vi.fn(async () => ({})),
    agentEscalate: vi.fn(async () => ({})),
    ...(overrides?.taskService ?? {}),
  };

  const app = fastify();
  registerErrorHandler(app);
  app.decorate('workflowService', workflowService as never);
  app.decorate('taskService', taskService as never);
  app.decorate('pgPool', (overrides?.pgPool ?? createDefaultPool()) as never);
  app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
  app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
  app.decorate('workspaceService', { getWorkspace: vi.fn(async () => ({ settings: {} })) } as never);
  app.decorate('modelCatalogService', {
    resolveRoleConfig: vi.fn(),
    listProviders: vi.fn(),
    listModels: vi.fn(),
    getProviderForOperations: vi.fn(),
  } as never);
  return { app, workflowService, taskService };
}

export const workflowRoutes = workflowRoutesModule;
