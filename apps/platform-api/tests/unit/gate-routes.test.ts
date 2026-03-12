import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
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
}));

describe('gate routes', () => {
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

  it('reads workflow-scoped gates by gate id', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [{
          id: 'gate-1',
          workflow_id: 'workflow-1',
          workflow_name: 'Workflow One',
          stage_id: 'stage-1',
          stage_name: 'requirements',
          stage_goal: 'Define scope',
          status: 'awaiting_approval',
          request_summary: 'Ready for review',
          recommendation: 'approve',
          concerns: [],
          key_artifacts: [],
          requested_by_type: 'orchestrator',
          requested_by_id: 'task-1',
          requested_at: new Date('2026-03-11T00:00:00Z'),
          updated_at: new Date('2026-03-11T00:00:00Z'),
          decided_by_type: null,
          decided_by_id: null,
          decision_feedback: null,
          decided_at: null,
        }],
      })),
    });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('projectService', { getProject: vi.fn() });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    });
    app.decorate('workflowService', {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      getWorkflowBoard: vi.fn(),
      listWorkflowStages: vi.fn(),
      listWorkflowWorkItems: vi.fn(),
      createWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItemMemory: vi.fn(),
      getWorkflowWorkItemMemoryHistory: vi.fn(),
      updateWorkflowWorkItem: vi.fn(),
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    });

    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/gates/gate-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'gate-1',
        workflow_id: 'workflow-1',
        stage_id: 'stage-1',
        requested_by_type: 'orchestrator',
      }),
    );
  });

  it('reads approval queue gates by gate id', async () => {
    const { approvalQueueRoutes } = await import('../../src/api/routes/approval-queue.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [{
          id: 'gate-2',
          workflow_id: 'workflow-2',
          workflow_name: 'Workflow Two',
          stage_id: 'stage-2',
          stage_name: 'qa',
          stage_goal: 'Validate release',
          status: 'awaiting_approval',
          request_summary: 'Ready for signoff',
          recommendation: 'approve',
          concerns: [],
          key_artifacts: [],
          requested_by_type: 'orchestrator',
          requested_by_id: 'task-2',
          requested_at: new Date('2026-03-11T01:00:00Z'),
          updated_at: new Date('2026-03-11T01:00:00Z'),
          decided_by_type: null,
          decided_by_id: null,
          decision_feedback: null,
          decided_at: null,
        }],
      })),
    });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });

    await app.register(approvalQueueRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals/gate-2',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'gate-2',
        workflow_id: 'workflow-2',
        stage_name: 'qa',
        requested_by_id: 'task-2',
      }),
    );
  });
});
