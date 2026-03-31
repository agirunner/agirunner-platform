import fastify from 'fastify';
import { expect, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';

export const mockWithAllowedScopes = vi.fn((_scopes: string[]) => async () => {});
export const mockWithScope = vi.fn((_scope: string) => async () => {});

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-1',
    };
  },
  withAllowedScopes: (scopes: string[]) => mockWithAllowedScopes(scopes),
  withScope: (scope: string) => mockWithScope(scope),
}));

export function resetTaskRouteAuthMocks() {
  mockWithAllowedScopes.mockImplementation(() => async () => {});
  mockWithScope.mockImplementation(() => async () => {});
}

export function buildTaskRouteApp(
  overrides: Record<string, unknown>,
  pool?: {
    connect: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  },
) {
  const app = fastify();
  registerErrorHandler(app);
  if (pool) {
    app.decorate('pgPool', pool as never);
  }
  app.decorate('taskService', createTaskService(overrides) as never);
  return app;
}

export function createTaskService(overrides?: Record<string, unknown>) {
  return {
    listTasks: vi.fn(),
    createTask: vi.fn(),
    getTask: vi.fn(),
    updateTask: vi.fn(),
    getTaskContext: vi.fn(),
    getTaskGitActivity: vi.fn(),
    claimTask: vi.fn(),
    resolveClaimCredentials: vi.fn(),
    startTask: vi.fn(),
    completeTask: vi.fn(),
    failTask: vi.fn(),
    approveTask: vi.fn(),
    approveTaskOutput: vi.fn(),
    retryTask: vi.fn(),
    cancelTask: vi.fn(),
    rejectTask: vi.fn(),
    requestTaskChanges: vi.fn(),
    skipTask: vi.fn(),
    reassignTask: vi.fn(),
    escalateTask: vi.fn(),
    respondToEscalation: vi.fn(),
    overrideTaskOutput: vi.fn(),
    agentEscalate: vi.fn(),
    resolveEscalation: vi.fn(),
    ...(overrides ?? {}),
  };
}

export function createWorkflowReplayPool(workflowId: string, toolName: string) {
  const storedResults = new Map<string, Record<string, unknown>>();
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT response') && sql.includes('FROM workflow_tool_results')) {
        expect(params).toEqual(['tenant-1', workflowId, toolName, expect.any(String)]);
        const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}:${params?.[3]}`;
        const response = storedResults.get(key);
        return response
          ? { rowCount: 1, rows: [{ response }] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO workflow_tool_results')) {
        expect(params?.slice(0, 5)).toEqual([
          'tenant-1',
          workflowId,
          toolName,
          expect.any(String),
          expect.any(Object),
        ]);
        const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}:${params?.[3]}`;
        const response = params?.[4] as Record<string, unknown>;
        const existing = storedResults.get(key);
        if (existing) {
          return { rowCount: 0, rows: [] };
        }
        storedResults.set(key, response);
        return { rowCount: 1, rows: [{ response }] };
      }
      throw new Error(`Unexpected SQL in replay pool: ${sql}`);
    }),
    release: vi.fn(),
  };

  return {
    connect: vi.fn(async () => client),
    query: vi.fn(),
  };
}

export function createTaskReplayPool(taskId: string, toolName: string) {
  const storedResults = new Map<string, Record<string, unknown>>();
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT response') && sql.includes('FROM task_tool_results')) {
        expect(params).toEqual(['tenant-1', taskId, toolName, expect.any(String)]);
        const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}:${params?.[3]}`;
        const response = storedResults.get(key);
        return response
          ? { rowCount: 1, rows: [{ response }] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO task_tool_results')) {
        expect(params).toEqual(['tenant-1', taskId, toolName, expect.any(String), expect.any(Object)]);
        const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}:${params?.[3]}`;
        const response = params?.[4] as Record<string, unknown>;
        const existing = storedResults.get(key);
        if (existing) {
          return { rowCount: 0, rows: [] };
        }
        storedResults.set(key, response);
        return { rowCount: 1, rows: [{ response }] };
      }
      throw new Error(`Unexpected SQL in task replay pool: ${sql}`);
    }),
    release: vi.fn(),
  };

  return {
    connect: vi.fn(async () => client),
    query: vi.fn(),
  };
}
