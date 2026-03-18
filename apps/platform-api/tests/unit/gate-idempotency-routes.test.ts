import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'admin-1',
    };
  },
  withScope: () => async () => {},
  withAllowedScopes: () => async () => {},
}));

describe('gate decision route idempotency', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  afterEach(async () => {
    vi.doUnmock('../../src/services/approval-queue-service.js');
    vi.doUnmock('../../src/services/playbook-workflow-control-service.js');
    vi.doUnmock('../../src/services/workflow-state-service.js');
    vi.doUnmock('../../src/services/workflow-activation-service.js');
    vi.doUnmock('../../src/services/workflow-activation-dispatch-service.js');
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('deduplicates repeated approval queue gate decisions by request_id', async () => {
    const actOnGate = vi.fn(async () => ({
      id: 'gate-1',
      workflow_id: 'workflow-1',
      status: 'approved',
      decision_feedback: 'Looks good',
    }));
    vi.doMock('../../src/services/approval-queue-service.js', () => ({
      ApprovalQueueService: vi.fn().mockImplementation(() => ({
        getGate: vi.fn(async () => ({ id: 'gate-1', workflow_id: 'workflow-1' })),
        listApprovals: vi.fn(),
      })),
    }));
    vi.doMock('../../src/services/playbook-workflow-control-service.js', () => ({
      PlaybookWorkflowControlService: vi.fn().mockImplementation(() => ({
        actOnGate,
      })),
    }));
    vi.doMock('../../src/services/workflow-state-service.js', () => ({
      WorkflowStateService: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('../../src/services/workflow-activation-service.js', () => ({
      WorkflowActivationService: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('../../src/services/workflow-activation-dispatch-service.js', () => ({
      WorkflowActivationDispatchService: vi.fn().mockImplementation(() => ({})),
    }));

    const { approvalQueueRoutes } = await import('../../src/api/routes/approval-queue.routes.js');

    app = await buildApp();
    await app.register(approvalQueueRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/approvals/gate-1',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'decision-1',
        action: 'approve',
        feedback: 'Looks good',
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/approvals/gate-1',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'decision-1',
        action: 'approve',
        feedback: 'Looks good',
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(actOnGate).toHaveBeenCalledTimes(1);
    expect(second.json()).toEqual(first.json());
  });

  it('rejects approval queue gate decisions without request_id', async () => {
    const actOnGate = vi.fn();
    vi.doMock('../../src/services/approval-queue-service.js', () => ({
      ApprovalQueueService: vi.fn().mockImplementation(() => ({
        getGate: vi.fn(async () => ({ id: 'gate-1', workflow_id: 'workflow-1' })),
        listApprovals: vi.fn(),
      })),
    }));
    vi.doMock('../../src/services/playbook-workflow-control-service.js', () => ({
      PlaybookWorkflowControlService: vi.fn().mockImplementation(() => ({
        actOnGate,
      })),
    }));
    vi.doMock('../../src/services/workflow-state-service.js', () => ({
      WorkflowStateService: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('../../src/services/workflow-activation-service.js', () => ({
      WorkflowActivationService: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('../../src/services/workflow-activation-dispatch-service.js', () => ({
      WorkflowActivationDispatchService: vi.fn().mockImplementation(() => ({})),
    }));

    const { approvalQueueRoutes } = await import('../../src/api/routes/approval-queue.routes.js');

    app = await buildApp();
    await app.register(approvalQueueRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/approvals/gate-1',
      headers: { authorization: 'Bearer test' },
      payload: {
        action: 'approve',
        feedback: 'Looks good',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(actOnGate).not.toHaveBeenCalled();
  });

  it('does not expose the deprecated workflow stage gate mutation route', async () => {
    vi.doMock('../../src/services/playbook-workflow-control-service.js', () => ({
      PlaybookWorkflowControlService: vi.fn().mockImplementation(() => ({
        actOnGate: vi.fn(),
      })),
    }));
    vi.doMock('../../src/services/approval-queue-service.js', () => ({
      ApprovalQueueService: vi.fn().mockImplementation(() => ({
        getGate: vi.fn(async () => ({ id: 'gate-1', workflow_id: 'workflow-1' })),
      })),
    }));
    vi.doMock('../../src/services/workflow-state-service.js', () => ({
      WorkflowStateService: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('../../src/services/workflow-activation-service.js', () => ({
      WorkflowActivationService: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('../../src/services/workflow-activation-dispatch-service.js', () => ({
      WorkflowActivationDispatchService: vi.fn().mockImplementation(() => ({})),
    }));

    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');

    app = await buildApp({
      workflowService: {
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
        getResolvedConfig: vi.fn(),
        cancelWorkflow: vi.fn(),
        pauseWorkflow: vi.fn(),
        resumeWorkflow: vi.fn(),
        deleteWorkflow: vi.fn(),
      },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/stages/requirements/gate',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'stage-decision-1',
        action: 'approve',
        feedback: 'Approved',
      },
    });

    expect(response.statusCode).toBe(404);
  });
});

async function buildApp(overrides?: { workflowService?: Record<string, unknown> }) {
  const toolResults = new Map<string, Record<string, unknown>>();
  const app = fastify();
  const { registerErrorHandler } = await import('../../src/errors/error-handler.js');
  registerErrorHandler(app);
  app.decorate('pgPool', {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('FROM workflow_tool_results')) {
          const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}:${params?.[3]}`;
          const response = toolResults.get(key);
          return { rowCount: response ? 1 : 0, rows: response ? [{ response }] : [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}:${params?.[3]}`;
          const existing = toolResults.get(key);
          if (existing) {
            return { rowCount: 0, rows: [] };
          }
          const response = params?.[4] as Record<string, unknown>;
          toolResults.set(key, response);
          return { rowCount: 1, rows: [{ response }] };
        }
        throw new Error(`Unexpected SQL in test pool: ${sql}`);
      }),
      release: vi.fn(),
    })),
    query: vi.fn(),
  } as never);
  app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
  app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
  app.decorate('projectService', { getProject: vi.fn(async () => ({ settings: {} })) } as never);
  app.decorate('modelCatalogService', {
    resolveRoleConfig: vi.fn(),
    listProviders: vi.fn(),
    listModels: vi.fn(),
    getProviderForOperations: vi.fn(),
  } as never);
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
    ...(overrides?.workflowService ?? {}),
  } as never);
  return app;
}
