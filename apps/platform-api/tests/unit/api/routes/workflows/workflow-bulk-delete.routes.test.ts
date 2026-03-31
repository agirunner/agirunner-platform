import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
import { workflowRoutes } from '../../../../../src/api/routes/workflows/routes.js';

const mockWithScope = vi.fn((_scope: string) => async () => {});
const mockWithAllowedScopes = vi.fn((_scopes: string[]) => async () => {});

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'admin-key',
    };
  },
  withScope: (scope: string) => mockWithScope(scope),
  withAllowedScopes: (scopes: string[]) => mockWithAllowedScopes(scopes),
}));

vi.mock('../../../../../src/services/document-reference/document-reference-service.js', () => ({
  createWorkflowDocument: vi.fn(),
  deleteWorkflowDocument: vi.fn(),
  listWorkflowDocuments: vi.fn(async () => []),
  updateWorkflowDocument: vi.fn(),
}));

describe('workflow bulk delete routes', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('posts explicit workflow ids to the bulk delete contract', async () => {
    const workflowIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    const deleteWorkflowsPermanently = vi.fn().mockResolvedValue({
      deleted: true,
      deleted_workflow_count: 2,
      deleted_task_count: 5,
      deleted_workflow_ids: workflowIds,
    });
    const app = createApp({ deleteWorkflowsPermanently });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/bulk-delete',
      payload: { workflow_ids: [workflowIds[0], workflowIds[1], workflowIds[0]] },
    });

    expect(response.statusCode).toBe(200);
    expect(deleteWorkflowsPermanently).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', scope: 'admin' }),
      [workflowIds[0], workflowIds[1], workflowIds[0]],
    );
    expect(response.json().data).toEqual({
      deleted: true,
      deleted_workflow_count: 2,
      deleted_task_count: 5,
      deleted_workflow_ids: workflowIds,
    });

    await app.close();
  });
});

function createApp(workflowServiceOverrides: Record<string, unknown>) {
  const app = fastify();
  registerErrorHandler(app);
  app.decorate(
    'workflowService',
    {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => [],
      listWorkflowWorkItems: async () => [],
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => [],
      listWorkflowWorkItemEvents: async () => [],
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
      ...workflowServiceOverrides,
    } as never,
  );
  app.decorate('pgPool', {
    query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
    connect: vi.fn(async () => ({
      query: vi.fn(async () => {
        throw new Error('unexpected pgPool.connect query');
      }),
      release: vi.fn(),
    })),
  } as never);
  app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
  app.decorate('eventService', { emit: async () => undefined } as never);
  app.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) } as never);
  app.decorate('workflowInputPacketService', {
    listWorkflowInputPackets: async () => [],
    createWorkflowInputPacket: async () => ({}),
    downloadWorkflowInputPacketFile: async () => ({
      file: { file_name: 'file.txt' },
      contentType: 'text/plain',
      data: Buffer.from('file'),
    }),
  } as never);
  app.decorate('workflowOperatorBriefService', {
    listWorkflowOperatorBriefs: async () => ({ items: [], next_cursor: null }),
    recordBrief: async () => ({}),
  } as never);
  app.decorate('workflowOperatorUpdateService', {
    listWorkflowOperatorUpdates: async () => ({ items: [], next_cursor: null }),
    recordUpdate: async () => ({}),
  } as never);
  app.decorate('workflowInterventionService', {
    createIntervention: async () => ({}),
    listInterventions: async () => ({ items: [], next_cursor: null }),
  } as never);
  app.decorate('workflowSteeringSessionService', {
    createSession: async () => ({}),
    createMessage: async () => ({}),
    listSessions: async () => ({ items: [], next_cursor: null }),
  } as never);
  app.decorate('workflowRedriveService', {
    createWorkflowRedrive: async () => ({}),
  } as never);
  app.decorate('workflowSettingsService', {
    getSettings: async () => ({ live_visibility_mode: 'enhanced', settings_revision: 0 }),
    updateSettings: async () => ({ live_visibility_mode: 'enhanced', settings_revision: 1 }),
  } as never);
  app.decorate('taskService', {
    getTask: async () => ({ workflow_id: 'workflow-1', work_item_id: 'work-item-1' }),
    retryTask: async () => ({}),
    skipTask: async () => ({}),
    cancelTask: async () => ({}),
    requestTaskChanges: async () => ({}),
    reassignTask: async () => ({}),
    approveTask: async () => ({}),
    rejectTask: async () => ({}),
    resolveEscalation: async () => ({}),
    agentEscalateTask: async () => ({}),
    overrideTaskOutput: async () => ({}),
  } as never);
  app.decorate('approvalQueueService', {
    approveOutput: async () => ({}),
  } as never);
  app.decorate('handoffService', {
    listTaskHandoffs: async () => [],
    getLatestTaskHandoff: async () => null,
  } as never);
  app.decorate('playbookWorkflowControlService', {
    requestStageGate: async () => ({}),
    resolveStageGate: async () => ({}),
  } as never);
  app.decorate('workflowActivationDispatchService', {
    dispatchWorkflowActivation: async () => undefined,
  } as never);
  app.decorate('workflowActivationService', {
    getActivation: async () => null,
  } as never);
  app.decorate('workflowDeliverableService', {
    listWorkflowDeliverables: async () => ({ items: [], next_cursor: null }),
  } as never);
  app.decorate('workflowStateService', {} as never);
  app.decorate('workflowToolResultService', {
    lockRequest: vi.fn(async () => undefined),
    getResult: vi.fn(async () => null),
    recordResult: vi.fn(async () => undefined),
  } as never);
  app.decorate('workflowChainingService', {
    chainWorkflowExplicit: async () => ({}),
  } as never);
  app.decorate('eventQueryService', {
    listEvents: async () => ({ items: [], next_cursor: null }),
  } as never);
  app.register(workflowRoutes);
  return app;
}
