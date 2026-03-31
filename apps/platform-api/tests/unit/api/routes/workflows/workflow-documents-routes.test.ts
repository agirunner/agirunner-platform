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
  withAllowedScopes: () => async () => {},
  withScope: () => async () => {},
}));

describe('workflow document routes', () => {
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

  it('creates workflow documents through the workflow route surface', async () => {
    const { workflowRoutes } = await import('../../../../../src/api/routes/workflows/routes.js');
    const createdDocument = {
      id: 'doc-1',
      logical_name: 'brief',
      source: 'external',
      location: 'https://example.com/brief',
      artifact_id: null,
      content_type: null,
      title: 'Brief',
      description: null,
      metadata: {},
      task_id: null,
      created_at: new Date('2026-03-12T00:00:00Z'),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('FROM workflow_tool_results')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'operator_create_workflow_document',
            'workflow-document-create-1',
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT workspace_id, workspace_spec_version') && sql.includes('FROM workflows')) {
          return {
            rowCount: 1,
            rows: [{ workspace_id: 'workspace-1', workspace_spec_version: 1 }],
          };
        }
        if (sql.includes('SELECT id, logical_name') && sql.includes('FROM workflow_documents')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_documents')) {
          return { rowCount: 1, rows: [createdDocument] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{ response: params?.[4] ?? createdDocument }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowService', {
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
    } as never);
    app.decorate(
      'pgPool',
      {
        connect: vi.fn(async () => client),
        query: vi.fn(),
      } as never,
    );
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
    app.decorate('eventService', { emit: vi.fn() } as never);
    app.decorate('workspaceService', { getWorkspace: vi.fn() } as never);
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    } as never);

    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/documents',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'workflow-document-create-1',
        logical_name: 'brief',
        source: 'external',
        url: 'https://example.com/brief',
        title: 'Brief',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.logical_name).toBe('brief');
    expect(response.json().data.url).toBe('https://example.com/brief');
  });
});
