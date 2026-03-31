import fastify from 'fastify';
import { expect, vi } from 'vitest';

import * as documentReferenceService from '../../../../../src/services/document-reference-service.js';
import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
import * as workflowRoutesModule from '../../../../../src/api/routes/workflows/routes.js';

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

vi.mock('../../../../../src/services/document-reference-service.js', () => ({
  createWorkflowDocument: vi.fn(),
  deleteWorkflowDocument: vi.fn(),
  listWorkflowDocuments: vi.fn(async () => []),
  updateWorkflowDocument: vi.fn(),
}));

export function resetWorkflowRouteAuthMocks() {
  mockWithAllowedScopes.mockImplementation(() => async () => {});
  mockWithScope.mockImplementation(() => async () => {});
}

export function createWorkflowControlReplayPool(workflowId: string, toolName: string) {
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
      throw new Error(`unexpected client query: ${sql}`);
    }),
    release: vi.fn(),
  };

  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO workflow_tool_results')) {
        storedResponse = params?.[4] as Record<string, unknown>;
        return { rowCount: 1, rows: [{ response: storedResponse }] };
      }
      throw new Error(`unexpected pool query: ${sql}`);
    }),
  };

  return { pool, client };
}

export function createTransactionalWorkflowReplayPool(workflowId: string, toolName: string) {
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

  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async () => {
      throw new Error('unexpected pool query');
    }),
  };

  return { pool, client };
}

export function createWorkflowRoutesApp(overrides?: {
  workflowService?: Record<string, unknown>;
  workflowInputPacketService?: Record<string, unknown>;
  workflowOperatorBriefService?: Record<string, unknown>;
  workflowOperatorUpdateService?: Record<string, unknown>;
  workflowInterventionService?: Record<string, unknown>;
  workflowSteeringSessionService?: Record<string, unknown>;
  workflowRedriveService?: Record<string, unknown>;
  workflowSettingsService?: Record<string, unknown>;
  pgPool?: Record<string, unknown>;
}) {
  const routeApp = fastify();
  registerErrorHandler(routeApp);
  routeApp.decorate(
    'workflowService',
    {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
      ...(overrides?.workflowService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'pgPool',
    ((overrides?.pgPool as Record<string, unknown> | undefined) ?? {
      query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
      connect: vi.fn(async () => ({
        query: vi.fn(async () => {
          throw new Error('unexpected pgPool.connect query');
        }),
        release: vi.fn(),
      })),
    }) as never,
  );
  routeApp.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
  routeApp.decorate('eventService', { emit: async () => undefined } as never);
  routeApp.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) } as never);
  routeApp.decorate(
    'workflowInputPacketService',
    {
      listWorkflowInputPackets: async () => [],
      createWorkflowInputPacket: async () => ({}),
      downloadWorkflowInputPacketFile: async () => ({
        file: { file_name: 'file.txt' },
        contentType: 'text/plain',
        data: Buffer.from('file'),
      }),
      ...(overrides?.workflowInputPacketService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'workflowOperatorBriefService',
    {
      listBriefs: async () => [],
      recordBriefWrite: async () => ({}),
      ...(overrides?.workflowOperatorBriefService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'workflowOperatorUpdateService',
    {
      listUpdates: async () => [],
      recordUpdateWrite: async () => ({}),
      ...(overrides?.workflowOperatorUpdateService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'workflowInterventionService',
    {
      listWorkflowInterventions: async () => [],
      recordIntervention: async () => ({}),
      downloadWorkflowInterventionFile: async () => ({
        file: { file_name: 'file.txt' },
        contentType: 'text/plain',
        data: Buffer.from('file'),
      }),
      ...(overrides?.workflowInterventionService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'workflowSteeringSessionService',
    {
      listSessions: async () => [],
      createSession: async () => ({}),
      listMessages: async () => [],
      appendMessage: async () => ({}),
      recordSteeringRequest: async () => ({}),
      ...(overrides?.workflowSteeringSessionService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'workflowRedriveService',
    {
      redriveWorkflow: async () => ({}),
      ...(overrides?.workflowRedriveService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'workflowSettingsService',
    {
      getWorkflowSettings: async () => ({}),
      updateWorkflowSettings: async () => ({}),
      ...(overrides?.workflowSettingsService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'modelCatalogService',
    {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
    } as never,
  );
  return routeApp;
}

export const createWorkflowDocument = vi.mocked(documentReferenceService.createWorkflowDocument);
export const deleteWorkflowDocument = vi.mocked(documentReferenceService.deleteWorkflowDocument);
export const updateWorkflowDocument = vi.mocked(documentReferenceService.updateWorkflowDocument);
export const workflowRoutes = workflowRoutesModule.workflowRoutes;
